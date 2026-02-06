# Data Pipeline, Clustering, and Color System

This document covers porting the R3F keyword graph's data pipeline to TouchDesigner: Supabase queries, embedding storage, Leiden clustering, LLM label generation, cosine similarity computation, PCA color mapping, and edge rendering data. These subsystems are responsible for everything between raw database records and the final per-node color/opacity/geometry values that instanced rendering consumes.

**Source data shape** (from the R3F app):
- **Keyword nodes**: 200-2000 nodes, each with id, label, communityId, and a 256-dim or 1536-dim embedding vector
- **Similarity edges**: 1000-10000 edges, each with source, target, similarity weight (0-1), and isKNN flag
- **Cluster assignments**: Leiden clustering at 8 resolution levels (0.1 to 4.0) with LLM-generated labels
- **Precomputed PCA transform**: 2x256 matrix for embedding-to-color mapping

---

## 1. Supabase from TD Python

### TD's Python Environment

TouchDesigner embeds its own Python interpreter (Python 3.11 in 2024-era builds). Verify the exact version in Textport:

```python
import sys
print(sys.version)       # e.g. "3.11.6 (tags/v3.11.6:...)"
print(sys.executable)    # Path to TD's embedded Python
print(sys.prefix)        # Root of TD's Python installation
```

**Python location by platform:**
- **macOS**: `/Applications/TouchDesigner.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3`
- **Windows**: `C:\Program Files\Derivative\TouchDesigner\bin\python.exe`

### Installing External Packages

There are three strategies, listed from most robust to most convenient:

**Strategy A: Portable site-packages with sys.path injection (recommended)**

Install packages into a project-local folder using a matching Python version, then add the folder to `sys.path` at project startup:

```bash
# On your system (must match TD's Python major.minor version)
python3.11 -m pip install --target "/path/to/td_packages" requests
```

In TD, add path in an `onStart` callback or Script DAT:

```python
import sys
pkg_dir = '/path/to/td_packages'
if pkg_dir not in sys.path:
    sys.path.insert(0, pkg_dir)
```

This approach survives TD updates (you just rebuild the target folder) and keeps the TD installation clean.

**Strategy B: Install directly into TD's Python**

```bash
# macOS
/Applications/TouchDesigner.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 -m pip install requests

# Windows
"C:\Program Files\Derivative\TouchDesigner\bin\python.exe" -m pip install requests
```

If pip is missing, try `python3 -m ensurepip` first. Some TD distributions ship without ensurepip -- use Strategy A instead.

**Strategy C: External Python microservice (for heavy dependencies)**

Run a separate Python process (FastAPI, Flask) and communicate via HTTP, WebSocket, or OSC. This is the recommended approach for packages with complex compiled dependencies (scipy, scikit-learn, leidenalg).

### Package Compatibility

| Package | Type | Works in TD? | Notes |
|---------|------|-------------|-------|
| `requests` | Pure Python | Yes | Straightforward. May need `REQUESTS_CA_BUNDLE` for SSL. |
| `urllib3` | Pure Python | Yes | Pulled in by requests. |
| `numpy` | Compiled | Usually | Many TD builds bundle numpy. Verify with `import numpy`. |
| `supabase-py` | Mixed | Risky | Pulls in `httpx`, `pydantic`, `cryptography`. The compiled `cryptography` wheel is the common failure point. |
| `python-igraph` | Compiled | Possible | Requires correct wheel for TD's Python version and platform. |
| `leidenalg` | Compiled | Difficult | Depends on igraph C core. Hard to get right in embedded environments. |
| `scikit-learn` | Compiled | Difficult | Large BLAS/LAPACK stack. Better via external service. |

**Practical recommendation**: Use `requests` (or `urllib.request` from stdlib) for Supabase and Claude API calls. Keep embeddings in numpy arrays. Run Leiden clustering either via precomputed database results or an external Python service.

### Querying Supabase via PostgREST (No SDK)

Supabase exposes PostgREST at `https://<PROJECT_REF>.supabase.co/rest/v1/`. This avoids the `supabase-py` dependency entirely.

**Auth headers (same for all requests):**

```python
import json

SUPABASE_URL = 'https://your-project.supabase.co'
SUPABASE_KEY = 'your-anon-key'  # or service role key for admin access

def sb_headers():
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
```

**Fetching rows with PostgREST filters:**

PostgREST uses query-string operators like `eq.`, `gte.`, `in.()`, `ilike.`:

```python
import requests
from urllib.parse import urlencode

def fetch_table(table, select='*', filters=None, order=None, limit=1000, offset=0):
    """
    Query a Supabase table with PostgREST filter syntax.

    filters is a dict of column -> PostgREST operator strings:
        {'level': 'eq.3', 'keyword_id': 'in.(uuid1,uuid2,uuid3)'}
    """
    params = {'select': select, 'limit': str(limit), 'offset': str(offset)}
    if order:
        params['order'] = order
    if filters:
        params.update(filters)

    # safe= preserves PostgREST operators in the query string
    url = f'{SUPABASE_URL}/rest/v1/{table}?' + urlencode(params, safe='.,()%*')
    resp = requests.get(url, headers=sb_headers(), timeout=15)
    resp.raise_for_status()
    return resp.json()
```

**Calling an RPC function (e.g., `get_keyword_graph`):**

RPC functions are POST requests with named parameters as JSON body:

```python
def rpc_call(function_name, params):
    """Call a Supabase RPC function and return JSON result."""
    url = f'{SUPABASE_URL}/rest/v1/rpc/{function_name}'
    resp = requests.post(url, headers=sb_headers(), json=params, timeout=30)
    resp.raise_for_status()
    return resp.json()

# Example: fetch keyword graph
raw_graph = rpc_call('get_keyword_graph', {
    'filter_node_type': 'article',
    'max_edges_per_node': 10,
    'min_similarity': 0.3,
})
```

**Paginated fetches (for tables with >1000 rows):**

PostgREST defaults to returning up to 1000 rows. For larger datasets, paginate:

```python
def fetch_all(table, select='*', filters=None, page_size=1000):
    """Fetch all rows from a table, paginating as needed."""
    results = []
    offset = 0
    while True:
        page = fetch_table(table, select, filters, limit=page_size, offset=offset)
        results.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return results
```

**Fetching embeddings in batches:**

The `keywords` table stores embeddings as `vector(256)` (or `vector(1536)`). PostgREST returns these as JSON arrays or bracket-delimited strings depending on Supabase configuration:

```python
def fetch_embeddings(keyword_ids, batch_size=100):
    """Fetch 256-dim embeddings for a list of keyword UUIDs."""
    embeddings = {}
    ids = list(keyword_ids.values()) if isinstance(keyword_ids, dict) else keyword_ids

    for i in range(0, len(ids), batch_size):
        batch = ids[i:i+batch_size]
        id_filter = ','.join(batch)
        rows = fetch_table(
            'keywords',
            select='id,keyword,embedding_256',
            filters={'id': f'in.({id_filter})'}
        )
        for row in rows:
            emb = row.get('embedding_256')
            if emb:
                if isinstance(emb, str):
                    emb = json.loads(emb)
                embeddings[row['keyword']] = emb

    return embeddings
```

**Fetching precomputed clusters:**

```python
def fetch_precomputed_clusters(node_ids, resolution=1.0):
    """Fetch precomputed Leiden clusters at a given resolution."""
    id_filter = ','.join(node_ids)
    return fetch_table(
        'precomputed_topic_clusters',
        select='node_id,cluster_id,cluster_label,hub_node_id,member_count',
        filters={
            'resolution': f'eq.{resolution}',
            'node_id': f'in.({id_filter})',
        }
    )
```

**Fallback: stdlib urllib (no external packages at all):**

If `requests` is unavailable, use `urllib.request`:

```python
import urllib.request
import urllib.parse
import json

def urllib_get(url, headers):
    req = urllib.request.Request(url, headers=headers, method='GET')
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))

def urllib_post(url, headers, payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, headers=headers, data=data, method='POST')
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode('utf-8'))
```

### Complete Data Projection Pipeline

After fetching the raw graph from `get_keyword_graph`, project to keyword-only nodes and edges (matching the R3F app's `getKeywordBackbone()`):

```python
def project_keyword_graph(raw_data):
    """
    Project RPC results to keyword-only graph.
    Port of getKeywordBackbone() from graph-queries.ts.

    Returns: (nodes, edges, keyword_ids)
    """
    keyword_set = set()
    keyword_ids = {}   # keyword_text -> uuid
    edge_map = {}      # "kwA|kwB" -> max_similarity

    for row in raw_data:
        kw1 = row['keyword_text']
        kw2 = row['similar_keyword_text']
        kw1_id = row['keyword_id']
        kw2_id = row['similar_keyword_id']
        sim = row['similarity']

        keyword_set.add(kw1)
        keyword_set.add(kw2)
        if kw1 not in keyword_ids:
            keyword_ids[kw1] = kw1_id
        if kw2 not in keyword_ids:
            keyword_ids[kw2] = kw2_id

        # Skip self-loops (same keyword in different articles)
        if kw1 == kw2:
            continue

        edge_key = '|'.join(sorted([kw1, kw2]))
        if edge_key not in edge_map or sim > edge_map[edge_key]:
            edge_map[edge_key] = sim

    nodes = [{'id': f'kw:{kw}', 'label': kw} for kw in keyword_set]
    edges = []
    for key, sim in edge_map.items():
        kw1, kw2 = key.split('|')
        edges.append({
            'source': f'kw:{kw1}',
            'target': f'kw:{kw2}',
            'similarity': sim,
        })

    return nodes, edges, keyword_ids
```

---

## 2. Table DAT Patterns and Embedding Storage

### Table DAT Performance Characteristics

Table DATs store all values as **strings**. This has implications:

- **Cell-by-cell writes** are expensive: each write triggers a cook and (if the viewer is open) a UI redraw
- **Bulk operations** (`appendRow`, `setSize` + row fill) are significantly faster than per-cell writes
- **Practical limits**: hundreds to a few thousand rows work well for occasional updates. Tens of thousands of rows are possible but degrade with frequent updates or open viewers.

**Performance rules of thumb:**

| Node count | 4 columns (id, label, cluster, degree) | 260 columns (+ 256 embedding dims) |
|---|---|---|
| 500 | Fast, no issues | Sluggish to populate, OK once loaded |
| 2000 | Fast, no issues | Slow to populate (~2-5s), avoid per-frame reads |
| 5000+ | Fine for structured data | Not recommended |

**Mitigation strategies:**
- Close the Table DAT viewer during bulk writes (reduces cook/redraw overhead)
- Use `setSize(rows, cols)` to pre-allocate before filling, rather than growing with repeated `appendRow`
- For per-frame numeric access, cache data in Python dicts or numpy arrays rather than reading from the DAT

### Table DAT API

```python
# Create and populate a Table DAT
table = op('nodes_table')
table.clear()                               # Remove all rows and columns
table.setSize(1001, 4)                      # Pre-allocate 1001 rows x 4 columns

# Set header
table[0, 0] = 'id'
table[0, 1] = 'label'
table[0, 2] = 'cluster_id'
table[0, 3] = 'degree'

# Bulk append (faster than cell-by-cell for growing tables)
table.appendRow(['kw:machine learning', 'machine learning', 3, 12])

# Replace existing row
table.replaceRow(1, ['kw:neural networks', 'neural networks', 3, 8])

# Read cell
label = table[1, 'label'].val    # Access by column name
label = table[1, 1].val          # Access by column index
```

### Recommended Storage Strategy

**Do not store 1536 embedding dimensions in Table DAT columns.** For 2000 nodes x 1536 dims, that is 3+ million string cells -- Table DATs are not designed for this. Even 256 dims is borderline at scale.

**Three-tier storage pattern:**

| Data type | Storage | Access pattern |
|---|---|---|
| Structured metadata (id, label, cluster, degree) | Table DAT | Occasional reads, used by other DATs |
| Per-frame rendering attributes (position, color, scale, opacity) | CHOP channels | Per-frame reads by instancing |
| Embedding vectors (256 or 1536 dim) | numpy arrays in Python dict | Per-frame math in Script CHOP/DAT |

**Embedding storage in numpy:**

For 2000 nodes x 256 dimensions at float32: `2000 * 256 * 4 bytes = ~2 MB`. For 1536 dims: `~12 MB`. Both are trivial in-memory.

```python
import numpy as np

# Global embedding storage (populated once on data load)
_embeddings = None       # shape (N, D), float32
_node_ids = None         # list of node IDs, index-matched to rows
_id_to_index = None      # dict: node_id -> row index

def store_embeddings(nodes, embeddings_by_label):
    """Store embeddings as a numpy matrix for fast vector math."""
    global _embeddings, _node_ids, _id_to_index

    _node_ids = [n['id'] for n in nodes]
    _id_to_index = {nid: i for i, nid in enumerate(_node_ids)}

    dim = 256  # or 1536
    _embeddings = np.zeros((len(nodes), dim), dtype=np.float32)

    for i, node in enumerate(nodes):
        emb = embeddings_by_label.get(node['label'])
        if emb:
            _embeddings[i] = emb

def get_embedding(node_id):
    """Get a single embedding vector by node ID."""
    idx = _id_to_index.get(node_id)
    if idx is not None:
        return _embeddings[idx]
    return None

def get_all_embeddings():
    """Get the full embedding matrix (N x D)."""
    return _embeddings
```

### CHOP Channels for Rendering Data

Per-frame data lives in CHOPs because Geometry COMPs read instance attributes from CHOPs natively:

```python
# Script CHOP: node_positions
# Outputs: tx, ty, tz channels, one sample per node

def onCook(scriptOp):
    n = len(node_positions)  # from force simulation
    scriptOp.clear()
    tx = scriptOp.appendChan('tx')
    ty = scriptOp.appendChan('ty')
    tz = scriptOp.appendChan('tz')
    scriptOp.numSamples = n

    for i, (x, y) in enumerate(node_positions):
        tx[i] = x
        ty[i] = y
        tz[i] = 0  # keywords at z=0
```

### Data Flow Diagram

```
Script DAT (Supabase fetch, runs once or on refresh)
  |
  +--> nodes_table (Table DAT) -- id, label, cluster_id, degree
  |
  +--> edges_table (Table DAT) -- source, target, similarity, is_knn
  |
  +--> Python dict: embeddings_by_label (keyword -> float[256])
  |    numpy array: _embeddings (N x 256, float32)
  |
  +--> clusters_table (Table DAT) -- cluster_id, label, hub, member_count
  |
  +--> node_positions (Script CHOP) -- tx, ty, tz (from force simulation)
  +--> node_colors (Script CHOP)    -- cr, cg, cb (from PCA coloring)
  +--> node_opacity (Script CHOP)   -- ca (from hover/search/zoom)
  +--> node_scales (Script CHOP)    -- scale (from zoom level)
  |
  +--> Geo COMP (Instanced circles)
       Instance from: node_positions, node_colors, node_opacity, node_scales
```

---

## 3. Leiden Clustering in Python

### What the R3F App Does

The web app uses `graphology` + `graphology-communities-louvain` (which exports a Leiden implementation) in `leiden-clustering.ts`:

1. Build an undirected graph from nodes and edges with similarity as edge weight
2. Run Leiden with a `resolution` parameter (higher = more, smaller clusters)
3. Compute betweenness centrality to identify peripheral clusters (bottom 25th percentile)
4. Select hub keyword per cluster (highest degree, then shortest label)

The app prefers precomputed clusters from the database (8 resolution levels: 0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0) and falls back to client-side Leiden only when precomputed data has <90% node coverage.

### Option A: Precomputed Clusters from Database (Recommended)

This avoids installing any graph libraries in TD:

```python
def load_precomputed_clusters(node_ids, resolution=1.0):
    """Load precomputed Leiden clusters from Supabase."""
    data = fetch_precomputed_clusters(node_ids, resolution)

    node_to_cluster = {}
    clusters = {}

    for row in data:
        node_id = row['node_id']
        cluster_id = row['cluster_id']
        node_to_cluster[node_id] = cluster_id

        if cluster_id not in clusters:
            clusters[cluster_id] = {
                'id': cluster_id,
                'label': row.get('cluster_label', ''),
                'hub': row.get('hub_node_id', ''),
                'members': [],
            }
        clusters[cluster_id]['members'].append(node_id)

    return node_to_cluster, clusters

# Pre-load all 8 resolution levels into a cache
RESOLUTION_LEVELS = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0]
cluster_cache = {}  # resolution -> (node_to_cluster, clusters)

def load_all_resolutions(node_ids):
    for res in RESOLUTION_LEVELS:
        ntc, clusters = load_precomputed_clusters(node_ids, res)
        cluster_cache[res] = (ntc, clusters)

def get_nearest_resolution(target):
    """Find the precomputed resolution closest to a target value."""
    return min(RESOLUTION_LEVELS, key=lambda r: abs(r - target))
```

### Option B: python-igraph + leidenalg (Runtime Clustering)

If `leidenalg` is installable, this is the direct port of `leiden-clustering.ts`:

```python
# pip install python-igraph leidenalg
import igraph as ig
import leidenalg

def compute_leiden_clustering(nodes, edges, resolution=1.0):
    """
    Port of computeLeidenClustering() from leiden-clustering.ts.

    Returns:
        node_to_cluster: dict mapping node ID to cluster ID
        clusters: dict mapping cluster ID to {id, members, hub, is_peripheral}
    """
    if not nodes:
        return {}, {}

    # Build igraph
    node_ids = [n['id'] for n in nodes]
    node_index = {nid: i for i, nid in enumerate(node_ids)}

    g = ig.Graph(n=len(nodes), directed=False)
    g.vs['name'] = node_ids
    g.vs['label'] = [n['label'] for n in nodes]

    edge_list = []
    weights = []
    seen = set()

    for e in edges:
        src = node_index.get(e['source'])
        tgt = node_index.get(e['target'])
        if src is None or tgt is None or src == tgt:
            continue
        key = (min(src, tgt), max(src, tgt))
        if key in seen:
            continue
        seen.add(key)
        edge_list.append(key)
        weights.append(e['similarity'])

    g.add_edges(edge_list)
    g.es['weight'] = weights

    # Run Leiden
    partition = leidenalg.find_partition(
        g,
        leidenalg.RBConfigurationVertexPartition,
        weights='weight',
        resolution_parameter=resolution,
    )

    # Betweenness centrality for periphery detection
    betweenness = g.betweenness()

    # Build cluster maps
    node_to_cluster = {}
    cluster_members = {}

    for i, cid in enumerate(partition.membership):
        nid = node_ids[i]
        node_to_cluster[nid] = cid
        if cid not in cluster_members:
            cluster_members[cid] = []
        cluster_members[cid].append({
            'id': nid,
            'label': nodes[i]['label'],
            'degree': g.degree(i),
            'centrality': betweenness[i],
        })

    # Identify peripheral clusters (bottom 25th percentile avg centrality)
    avg_centralities = sorted([
        sum(m['centrality'] for m in members) / len(members)
        for members in cluster_members.values()
    ])
    threshold = avg_centralities[len(avg_centralities) // 4] if avg_centralities else 0

    clusters = {}
    for cid, members in cluster_members.items():
        avg_c = sum(m['centrality'] for m in members) / len(members)
        sorted_m = sorted(members, key=lambda m: (-m['degree'], len(m['label'])))
        clusters[cid] = {
            'id': cid,
            'members': [m['label'] for m in members],
            'hub': sorted_m[0]['label'],
            'is_peripheral': avg_c <= threshold,
        }

    return node_to_cluster, clusters
```

**Performance**: igraph + leidenalg handles 2000 nodes in ~50-150ms including betweenness centrality. This is fine for interactive use but not for per-frame execution.

### Option C: igraph Without leidenalg (Louvain Fallback)

As of recent igraph versions, **Leiden is not part of igraph's Python API** -- it comes from the separate `leidenalg` package. If you can install `python-igraph` but not `leidenalg`, use Louvain as a fallback:

```python
import igraph as ig

def compute_louvain_clustering(nodes, edges, resolution=1.0):
    """Louvain community detection via igraph (no leidenalg needed)."""
    g = build_igraph(nodes, edges)  # same graph building as above

    # igraph's multilevel method is Louvain
    communities = g.community_multilevel(weights='weight', resolution=resolution)

    node_to_cluster = {}
    for i, cid in enumerate(communities.membership):
        node_to_cluster[nodes[i]['id']] = cid

    return node_to_cluster
```

Other igraph alternatives:
- `g.community_walktrap(weights='weight').as_clustering()` -- random walk based, sometimes better quality
- `g.community_infomap(edge_weights='weight')` -- information-theoretic, good for flow-like graphs
- `g.community_label_propagation(weights='weight')` -- very fast but less stable

### Option D: NetworkX (Pure Python, No Compilation)

If no compiled packages are available, NetworkX provides pure-Python community detection:

```python
import networkx as nx
from networkx.algorithms.community import louvain_communities

def compute_nx_clustering(nodes, edges, resolution=1.0, seed=42):
    """Pure-Python Louvain via NetworkX. Slower but no compiled deps."""
    G = nx.Graph()
    for n in nodes:
        G.add_node(n['id'], label=n['label'])
    for e in edges:
        G.add_edge(e['source'], e['target'], weight=e['similarity'])

    communities = louvain_communities(G, weight='weight', resolution=resolution, seed=seed)

    node_to_cluster = {}
    for cid, members in enumerate(communities):
        for nid in members:
            node_to_cluster[nid] = cid

    return node_to_cluster
```

**Performance comparison** (approximate, 1000 nodes, 5000 edges):

| Method | Time | Notes |
|--------|------|-------|
| igraph + leidenalg | ~50-100ms | Best quality, guarantees connected communities |
| igraph Louvain | ~30-80ms | Good quality, may produce disconnected communities |
| NetworkX Louvain | ~500ms-2s | Pure Python, no compilation issues |
| Precomputed (DB fetch) | ~100-500ms | Network latency only, zero compute |

### Option E: External Python Service

For maximum reliability, run clustering in a separate FastAPI service:

```python
# FastAPI service (runs in its own Python environment with leidenalg)
# POST /cluster with {nodes, edges, resolution}
# Returns {node_to_cluster, clusters}

# In TD, call via requests:
def cluster_via_service(nodes, edges, resolution=1.0):
    resp = requests.post('http://localhost:8000/cluster', json={
        'nodes': nodes,
        'edges': edges,
        'resolution': resolution,
    }, timeout=10)
    return resp.json()
```

This keeps TD's Python environment clean and lets you use any scientific Python packages freely.

---

## 4. LLM API Calls from TD

### Calling Claude API with requests

The Anthropic Messages API requires three headers and a JSON body:

```python
import requests
import json
import os

ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', 'your-key-here')

def call_claude(system_prompt, user_message, model='claude-haiku-4-0', max_tokens=256):
    """
    Call the Anthropic Messages API.

    Returns the text content from the response.
    """
    resp = requests.post(
        'https://api.anthropic.com/v1/messages',
        headers={
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        json={
            'model': model,
            'max_tokens': max_tokens,
            'system': system_prompt,
            'messages': [{'role': 'user', 'content': user_message}],
            'temperature': 0.2,  # Low temperature for consistent labels
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    # Extract text from content blocks
    text = ''
    for block in data.get('content', []):
        if block.get('type') == 'text':
            text += block.get('text', '')
    return text.strip()
```

**Generating cluster labels (matching the R3F app's `/api/cluster-labels` endpoint):**

```python
def generate_cluster_labels(clusters):
    """
    Generate semantic labels for multiple clusters in one API call.

    Args:
        clusters: dict of cluster_id -> {members: [str], hub: str}

    Returns:
        dict of cluster_id -> label string
    """
    system = (
        "You label keyword clusters. For each cluster, return a short label "
        "(2-4 words) that captures the semantic theme. Return valid JSON mapping "
        "cluster ID (as string) to label. No markdown wrapping."
    )

    descriptions = []
    for cid, cluster in clusters.items():
        keywords = ', '.join(cluster['members'][:20])  # Cap at 20 per cluster
        descriptions.append(f'Cluster {cid}: {keywords}')

    user_msg = '\n'.join(descriptions)
    text = call_claude(system, user_msg, max_tokens=1024)

    # Parse JSON (handle potential markdown code block wrapping)
    if '```json' in text:
        text = text.split('```json')[1].split('```')[0]
    elif '```' in text:
        text = text.split('```')[1].split('```')[0]

    try:
        labels = json.loads(text.strip())
        return {int(k): v for k, v in labels.items()}
    except (json.JSONDecodeError, ValueError):
        print(f'[cluster-labels] Failed to parse: {text[:200]}')
        return {}
```

### Async Pattern: Threading + Queue

TouchDesigner's Python runs on the main thread. HTTP calls block rendering. Use `threading` with a `queue.Queue` for non-blocking API calls:

```python
import threading
import queue

# Shared queue: worker threads put results, main thread polls
_result_queue = queue.Queue()

def _label_worker(cluster_id, keywords):
    """Background thread: call Claude API and enqueue result."""
    try:
        label = call_claude(
            "You label keyword clusters. Return only the label (2-4 words).",
            f"Keywords: {', '.join(keywords[:20])}",
        )
        _result_queue.put(('ok', cluster_id, label))
    except Exception as e:
        _result_queue.put(('error', cluster_id, str(e)))

def request_label_async(cluster_id, keywords):
    """Fire-and-forget: start a background thread for one cluster label."""
    t = threading.Thread(
        target=_label_worker,
        args=(cluster_id, keywords),
        daemon=True,
    )
    t.start()

def request_labels_batch(clusters):
    """Request labels for all clusters asynchronously."""
    for cid, cluster in clusters.items():
        request_label_async(cid, cluster['members'])

def poll_label_results():
    """
    Call this from a Timer CHOP callback or Execute DAT (every frame or every N frames).
    Only touches TD operators on the main thread.
    """
    labels = {}
    while True:
        try:
            status, cluster_id, payload = _result_queue.get_nowait()
        except queue.Empty:
            break

        if status == 'ok':
            labels[cluster_id] = payload
        else:
            print(f'[label-worker] Error for cluster {cluster_id}: {payload}')

    if labels:
        # Update the clusters_table DAT on the main thread
        clusters_dat = op('clusters_table')
        for cid, label in labels.items():
            # Find the row for this cluster and update the label column
            for row in range(1, clusters_dat.numRows):
                if int(clusters_dat[row, 'cluster_id'].val) == cid:
                    clusters_dat[row, 'label'] = label
                    break

    return labels
```

**Wiring into TD's frame loop:**

Use a **Timer CHOP** or **Execute DAT** (`onFrameEnd` callback) to poll the queue every frame:

```python
# Execute DAT callback
def onFrameEnd(frame):
    poll_label_results()
```

**For batch operations (loading many labels at once):** Consider the single-call batched approach in `generate_cluster_labels()` above. Send all clusters in one API call, run it in a single background thread, and parse all results together. This reduces API call count and latency.

### Caching with SQLite

Python's built-in `sqlite3` module works in TD's Python. This is more robust than JSON file caching and supports concurrent reads.

**Database location:** Store next to the `.toe` file using `project.folder`:

```python
import sqlite3
import os
import time
import math

def cache_db_path():
    """Path to cache database, adjacent to the .toe project file."""
    base = project.folder  # TD global: folder containing the .toe
    cache_dir = os.path.join(base, 'cache')
    os.makedirs(cache_dir, exist_ok=True)
    return os.path.join(cache_dir, 'cluster_labels.sqlite')

def init_cache():
    """Create cache database and table if needed."""
    con = sqlite3.connect(cache_db_path())
    con.execute('''
        CREATE TABLE IF NOT EXISTS cluster_label (
            centroid_hash TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            keywords TEXT NOT NULL,
            centroid BLOB NOT NULL,
            updated_at REAL NOT NULL
        )
    ''')
    con.commit()
    return con

def centroid_hash(centroid):
    """Quick hash of a centroid vector for exact-match lookups."""
    # Round to 4 decimal places for slight tolerance
    return ','.join(f'{v:.4f}' for v in centroid[:8])  # First 8 dims as key

def cache_put(con, centroid, label, keywords):
    """Store a label in the cache."""
    import json
    h = centroid_hash(centroid)
    blob = json.dumps(centroid).encode()
    kw_json = json.dumps(sorted(keywords))
    con.execute(
        'INSERT OR REPLACE INTO cluster_label VALUES (?, ?, ?, ?, ?)',
        (h, label, kw_json, blob, time.time())
    )
    con.commit()

def cache_get_similar(con, centroid, threshold=0.85):
    """
    Find the best cached label by cosine similarity to centroid.
    Scans all entries (fine for <1000 cached labels).
    """
    rows = con.execute('SELECT centroid, label, updated_at FROM cluster_label').fetchall()
    best_label = None
    best_sim = -1

    for blob, label, _ in rows:
        cached_centroid = json.loads(blob)
        sim = cosine_similarity(centroid, cached_centroid)
        if sim >= threshold and sim > best_sim:
            best_sim = sim
            best_label = label

    return best_label, best_sim
```

**Full label-with-cache pipeline:**

```python
def get_labels_with_cache(clusters, embeddings_by_label):
    """
    Get cluster labels using SQLite cache, calling Claude API only for misses.
    Port of useClusterLabels hook's fetchLabelsWithCache().
    """
    con = init_cache()
    labels = {}
    misses = []

    for cid, cluster in clusters.items():
        member_embs = [
            embeddings_by_label[kw]
            for kw in cluster['members']
            if kw in embeddings_by_label
        ]

        centroid = compute_centroid(member_embs)
        if centroid is None:
            labels[cid] = cluster.get('hub', f'Cluster {cid}')
            continue

        cached_label, sim = cache_get_similar(con, centroid)
        if cached_label:
            labels[cid] = cached_label
        else:
            misses.append((cid, cluster, centroid))

    # Fetch fresh labels for misses
    if misses:
        miss_clusters = {cid: cluster for cid, cluster, _ in misses}
        fresh = generate_cluster_labels(miss_clusters)

        for cid, cluster, centroid in misses:
            label = fresh.get(cid, cluster.get('hub', f'Cluster {cid}'))
            labels[cid] = label
            cache_put(con, centroid, label, cluster['members'])

    con.close()
    return labels
```

---

## 5. Cosine Similarity in TD

### Pure Python (Small Scale)

For N < 500 nodes and 256 dimensions, pure Python cosine similarity runs fast enough for per-frame hover highlighting:

```python
import math

def cosine_similarity(a, b):
    """Cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
```

### numpy (Recommended for 500-2000 Nodes)

numpy vectorizes the entire operation. A single centroid vs. all nodes:

```python
import numpy as np

def cosine_similarity_batch(embeddings, centroid):
    """
    Compute cosine similarity of all embeddings against a centroid.

    Args:
        embeddings: numpy array shape (N, D)
        centroid: numpy array shape (D,)

    Returns:
        numpy array shape (N,) of similarity scores
    """
    # Dot product of each row with centroid
    dots = embeddings @ centroid                          # (N,)
    norms = np.linalg.norm(embeddings, axis=1)           # (N,)
    centroid_norm = np.linalg.norm(centroid)              # scalar
    denominators = norms * centroid_norm                  # (N,)

    # Avoid division by zero
    denominators = np.where(denominators > 0, denominators, 1.0)
    return dots / denominators

# Example: hover highlight (all nodes vs. cursor-area centroid)
similarities = cosine_similarity_batch(_embeddings, hover_centroid)
highlighted_mask = similarities >= 0.7  # threshold
```

**Performance**: For 2000 nodes x 256 dims, `embeddings @ centroid` is a single BLAS operation taking ~0.01ms. This is effectively free at 60fps.

For **pairwise similarity** (N x N matrix), used for k-NN edge computation:

```python
def pairwise_cosine_similarity(embeddings):
    """
    Compute NxN cosine similarity matrix.

    Args:
        embeddings: numpy array shape (N, D)

    Returns:
        numpy array shape (N, N)
    """
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normalized = embeddings / np.where(norms > 0, norms, 1.0)
    return normalized @ normalized.T

# For 2000 nodes: (2000, 256) @ (256, 2000) -> (2000, 2000) in ~10ms
```

### GLSL for GPU-Accelerated Similarity

For very large node counts (5000+) or per-pixel operations, cosine similarity can run on the GPU via GLSL TOP.

**Approach**: Store embeddings as a float texture, then compute similarity in a fragment shader.

**Step 1: Pack embeddings into a texture**

For 256-dim embeddings with RGBA32F format (4 floats per pixel):
- Texture width = 256 / 4 = 64 pixels
- Texture height = N (one row per node)

For 1536-dim embeddings:
- Texture width = 1536 / 4 = 384 pixels
- Texture height = N

Memory: 2000 nodes x 384 RGBA32F pixels = 2000 x 384 x 16 bytes = ~12 MB. Well within GPU limits.

**Step 2: Upload via CHOP-to-TOP chain**

The operator chain to get a numpy array into a float texture:

```
Script CHOP (4 channels: r,g,b,a with width*height samples)
  --> CHOP to TOP (set resolution to width x height, 32-bit float)
      --> GLSL TOP (reads texture as embedding data)
```

In the Script CHOP, flatten the embedding matrix into 4 interleaved channels:

```python
# Script CHOP: embedding_to_texture
def onCook(scriptOp):
    embs = get_all_embeddings()  # (N, D) numpy array
    N, D = embs.shape
    width = D // 4  # 64 for 256d, 384 for 1536d

    scriptOp.clear()
    r_ch = scriptOp.appendChan('r')
    g_ch = scriptOp.appendChan('g')
    b_ch = scriptOp.appendChan('b')
    a_ch = scriptOp.appendChan('a')
    scriptOp.numSamples = N * width  # Total "pixels"

    # Reshape: (N, D) -> (N, width, 4) -> flatten to (N*width, 4)
    reshaped = embs.reshape(N, width, 4)
    flat = reshaped.reshape(-1, 4)

    for i in range(flat.shape[0]):
        r_ch[i] = flat[i, 0]
        g_ch[i] = flat[i, 1]
        b_ch[i] = flat[i, 2]
        a_ch[i] = flat[i, 3]
```

**Note**: This per-sample loop is slow for large arrays. If your TD build supports Script TOP with numpy input, use that instead for direct buffer writes (see TD documentation for `scriptOp.copyNumpyArray()` or equivalent).

**Alternative: Script TOP** (if available in your build):

```python
# Script TOP: embedding_texture
def onCook(scriptOp):
    embs = get_all_embeddings()  # (N, D) numpy array
    N, D = embs.shape
    width = D // 4

    # Set output resolution and format
    scriptOp.par.outputresolution = 'custom'
    scriptOp.par.resolutionw = width
    scriptOp.par.resolutionh = N
    scriptOp.par.format = 'rgba32float'

    # Reshape to (height, width, 4) and write
    img = embs.reshape(N, width, 4).astype('float32')
    scriptOp.copyNumpyArray(img)  # Method name varies by TD build
```

**Step 3: GLSL TOP fragment shader for cosine similarity**

Compute similarity of every node against a query vector (e.g., hover centroid). The query vector is passed as a single-row texture or as uniforms.

```glsl
// GLSL TOP: cosine_similarity_shader
// Input 0: embedding texture (width=D/4, height=N, RGBA32F)
// Input 1: query vector texture (width=D/4, height=1, RGBA32F)
// Output: Nx1 texture where pixel (0,i) = similarity of node i to query

uniform int uDimOver4;  // D/4 (e.g., 64 for 256d)

void main() {
    int nodeIdx = int(gl_FragCoord.y);

    float dotProd = 0.0;
    float normA = 0.0;
    float normB = 0.0;

    for (int k = 0; k < uDimOver4; k++) {
        vec4 a = texelFetch(sTD2DInputs[0], ivec2(k, nodeIdx), 0);
        vec4 b = texelFetch(sTD2DInputs[1], ivec2(k, 0), 0);

        dotProd += dot(a, b);       // 4 multiply-adds at once
        normA += dot(a, a);
        normB += dot(b, b);
    }

    float sim = dotProd / (sqrt(normA) * sqrt(normB) + 1e-8);
    fragColor = vec4(sim, sim, sim, 1.0);
}
```

With RGBA32F packing, the inner loop processes 4 dimensions per iteration. For 256 dims, that is 64 loop iterations per fragment. For 1536 dims, 384 iterations per fragment. Modern GPUs handle this easily for N < 10000.

**Reading results back**: Use TOP to CHOP to read the Nx1 similarity texture back into CHOP channels for threshold filtering.

**When to use GPU similarity vs. numpy**:

| Node count | Dimensions | Recommendation |
|---|---|---|
| < 500 | 256 | Pure Python is fine |
| 500-2000 | 256 | numpy batch (0.01ms) |
| 500-2000 | 1536 | numpy batch (~0.1ms) |
| 2000-10000 | 256 | numpy or GPU |
| 2000-10000 | 1536 | GPU recommended |
| > 10000 | any | GPU required |

---

## 6. PCA and Color Mapping

### What the R3F App Does

The color pipeline (from `semantic-colors.ts`):

1. **Pre-computed PCA transform**: A 2x256 matrix stored in `/data/embedding-pca-transform.json`, computed once by `scripts/maintenance/compute-embedding-pca.ts` using sklearn
2. **PCA projection**: Dot product of embedding with each PCA row gives 2D coordinates
3. **Polar-to-HSL mapping**: `atan2(y,x)` -> hue (0-360), `sqrt(x^2+y^2)` -> saturation (50-100%), lightness fixed at 45%
4. **Cluster coloring**: Compute centroid of cluster member embeddings, project to 2D, derive base HSL. Per-node: offset from centroid gives +/-15 degree hue shift and saturation/lightness adjustments
5. **Mix ratio**: Slider blends between cluster-derived and pure per-node coloring
6. **Desaturation**: Reduces chroma in LCH color space

### Python Port: Core Functions

```python
import math
import colorsys

def dot_product(a, b):
    """Dot product of two vectors."""
    return sum(x * y for x, y in zip(a, b))

def pca_project(embedding, transform):
    """Project embedding to 2D via pre-computed PCA transform."""
    x = dot_product(transform[0], embedding)
    y = dot_product(transform[1], embedding)
    return x, y

def coordinates_to_hsl(x, y):
    """
    Map 2D PCA coordinates to HSL.
    Port of coordinatesToHSL() from semantic-colors.ts.

    Returns: (h, s, l) with h in [0,360], s in [0,100], l in [0,100]
    """
    angle = math.atan2(y, x)
    hue = ((angle / math.pi + 1) * 180) % 360

    radius = math.sqrt(x * x + y * y)
    saturation = 50 + min(50, radius * 200)

    lightness = 45
    return hue, saturation, lightness

def hsl_to_rgb(h, s, l):
    """
    HSL to RGB.
    h: 0-360, s: 0-100, l: 0-100.
    Returns: (r, g, b) each 0.0-1.0.

    Note: Python's colorsys uses HLS order (not HSL) with 0-1 ranges.
    """
    return colorsys.hls_to_rgb(h / 360.0, l / 100.0, s / 100.0)

def embedding_to_rgb(embedding, transform):
    """Full pipeline: embedding -> PCA -> polar -> HSL -> RGB."""
    x, y = pca_project(embedding, transform)
    h, s, l = coordinates_to_hsl(x, y)
    return hsl_to_rgb(h, s, l)
```

### Cluster Coloring with Mix Ratio

```python
def compute_centroid(embeddings):
    """Average and normalize a list of embedding vectors."""
    if not embeddings:
        return None
    dim = len(embeddings[0])
    centroid = [0.0] * dim
    for emb in embeddings:
        for i in range(dim):
            centroid[i] += emb[i]
    for i in range(dim):
        centroid[i] /= len(embeddings)
    # Normalize
    norm = math.sqrt(sum(x * x for x in centroid))
    if norm > 0:
        centroid = [x / norm for x in centroid]
    return centroid

def compute_cluster_color_info(member_embeddings, transform):
    """
    Compute base color info for a cluster.
    Port of computeClusterColorInfo() from semantic-colors.ts.
    """
    centroid = compute_centroid(member_embeddings)
    if centroid is None:
        return None
    cx, cy = pca_project(centroid, transform)

    angle = math.atan2(cy, cx)
    hue = ((angle / math.pi + 1) * 180) % 360
    radius = math.sqrt(cx * cx + cy * cy)
    saturation = 50 + min(50, radius * 200)
    lightness = 45

    return {
        'h': hue, 's': saturation, 'l': lightness,
        'pca_centroid': (cx, cy),
    }

def node_color_from_cluster(node_embedding, cluster_info, transform, mix_ratio=0.0):
    """
    Blend between cluster-derived and per-node coloring.
    Port of nodeColorFromCluster() from semantic-colors.ts.

    mix_ratio: 0 = cluster color with small variations, 1 = pure node color
    Returns: (r, g, b) tuple, each 0-1
    """
    nx, ny = pca_project(node_embedding, transform)
    cx, cy = cluster_info['pca_centroid']

    # -- Cluster-derived color with variations --
    dx, dy = nx - cx, ny - cy
    offset_dist = math.sqrt(dx * dx + dy * dy)
    offset_angle = math.atan2(dy, dx)
    hue_shift = (offset_angle / math.pi) * 15  # +/- 15 degrees

    sat_adjust = max(-15, 10 - offset_dist * 80)
    light_adjust = min(10, offset_dist * 30)

    cluster_h = (cluster_info['h'] + hue_shift) % 360
    cluster_s = max(30, min(100, cluster_info['s'] + sat_adjust))
    cluster_l = max(30, min(60, cluster_info['l'] + light_adjust))

    # -- Node's own color --
    node_angle = math.atan2(ny, nx)
    node_h = ((node_angle / math.pi + 1) * 180) % 360
    node_radius = math.sqrt(nx * nx + ny * ny)
    node_s = 50 + min(50, node_radius * 200)
    node_l = 45

    # -- Blend (shortest hue path) --
    hue_diff = node_h - cluster_h
    if abs(hue_diff) <= 180:
        h = cluster_h + hue_diff * mix_ratio
    elif hue_diff > 0:
        h = cluster_h + (hue_diff - 360) * mix_ratio
    else:
        h = cluster_h + (hue_diff + 360) * mix_ratio
    h = h % 360

    s = cluster_s + (node_s - cluster_s) * mix_ratio
    l = cluster_l + (node_l - cluster_l) * mix_ratio

    return hsl_to_rgb(h, s, l)
```

### Computing PCA from Scratch

If you do not have the pre-computed transform file, compute PCA using numpy (or sklearn if available):

**numpy-only PCA (no sklearn dependency):**

```python
import numpy as np

def compute_pca_transform_numpy(embeddings_list, n_components=2):
    """
    Compute PCA transform using only numpy (no sklearn).

    Args:
        embeddings_list: list of D-dimensional vectors
        n_components: number of principal components (2 for color mapping)

    Returns:
        transform: list of n_components rows, each D floats
    """
    X = np.array(embeddings_list, dtype=np.float64)

    # Center the data
    mean = X.mean(axis=0)
    X_centered = X - mean

    # Covariance matrix
    cov = np.cov(X_centered, rowvar=False)  # (D, D)

    # Eigendecomposition (for D=256 this takes ~0.1s)
    eigenvalues, eigenvectors = np.linalg.eigh(cov)

    # eigh returns eigenvalues in ascending order; reverse for largest first
    idx = np.argsort(eigenvalues)[::-1]
    components = eigenvectors[:, idx[:n_components]].T  # (n_components, D)

    return components.tolist()
```

**sklearn PCA (if available):**

```python
from sklearn.decomposition import PCA

def compute_pca_transform_sklearn(embeddings_list):
    X = np.array(embeddings_list)
    pca = PCA(n_components=2)
    pca.fit(X)
    return pca.components_.tolist()  # 2 x D
```

### LCH Desaturation

The R3F app uses chroma.js for perceptual desaturation in LCH color space. Python port using sRGB -> Lab -> LCH math:

```python
def rgb_to_lab(r, g, b):
    """Convert sRGB (0-1) to CIELAB."""
    def linearize(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    rl, gl, bl = linearize(r), linearize(g), linearize(b)

    x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl
    y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl
    z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl

    xn, yn, zn = 0.95047, 1.0, 1.08883  # D65

    def f(t):
        return t ** (1/3) if t > (6/29)**3 else t / (3 * (6/29)**2) + 4/29

    L = 116 * f(y / yn) - 16
    a = 500 * (f(x / xn) - f(y / yn))
    b_val = 200 * (f(y / yn) - f(z / zn))
    return L, a, b_val

def lab_to_rgb(L, a, b):
    """Convert CIELAB to sRGB (0-1)."""
    xn, yn, zn = 0.95047, 1.0, 1.08883

    def f_inv(t):
        return t ** 3 if t > 6/29 else 3 * (6/29)**2 * (t - 4/29)

    fy = (L + 16) / 116
    fx = a / 500 + fy
    fz = fy - b / 200

    x = xn * f_inv(fx)
    y = yn * f_inv(fy)
    z = zn * f_inv(fz)

    rl =  3.2404542 * x - 1.5371385 * y - 0.4985314 * z
    gl = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z
    bl =  0.0556434 * x - 0.2040259 * y + 1.0572252 * z

    def gamma(c):
        c = max(0.0, min(1.0, c))
        return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1/2.4)) - 0.055

    return gamma(rl), gamma(gl), gamma(bl)

def desaturate_lch(r, g, b, amount):
    """
    Reduce chroma in LCH space, preserving perceptual lightness.
    amount: 0 = no change, 1 = fully desaturated.
    """
    if amount == 0:
        return r, g, b

    L, a, b_val = rgb_to_lab(r, g, b)
    C = math.sqrt(a * a + b_val * b_val)
    H = math.atan2(b_val, a)

    C_new = C * (1 - amount)
    a_new = C_new * math.cos(H)
    b_new = C_new * math.sin(H)

    return lab_to_rgb(L, a_new, b_new)
```

### Batch Color Computation

Pre-compute all node colors when data loads (not per-frame):

```python
def compute_all_colors(nodes, embeddings_by_label, node_to_cluster, clusters, transform, mix_ratio=0.3):
    """
    Compute RGB colors for all nodes.
    Returns: list of (r, g, b) tuples in node order.
    """
    # Pre-compute cluster color info
    cluster_colors = {}
    for cid, cluster in clusters.items():
        member_embs = [
            embeddings_by_label[kw]
            for kw in cluster['members']
            if kw in embeddings_by_label
        ]
        info = compute_cluster_color_info(member_embs, transform)
        if info:
            cluster_colors[cid] = info

    colors = []
    for node in nodes:
        emb = embeddings_by_label.get(node['label'])
        cid = node_to_cluster.get(node['id'])
        cinfo = cluster_colors.get(cid) if cid is not None else None

        if emb and cinfo:
            r, g, b = node_color_from_cluster(emb, cinfo, transform, mix_ratio)
        elif emb:
            r, g, b = embedding_to_rgb(emb, transform)
        else:
            r, g, b = 0.61, 0.64, 0.68  # Grey fallback

        colors.append((r, g, b))

    return colors
```

---

## 7. Edge Rendering Data

### What the R3F App Does

Edge rendering in the R3F app (`edge-curves.ts` and `EdgeRenderer.tsx`):

1. **Curve direction**: Each edge bows outward from the graph centroid (Lombardi-style). Direction is computed by dotting the outward vector (centroid -> edge midpoint) with the edge perpendicular.
2. **Sagitta-based arcs**: Given two endpoints, a `curveIntensity` parameter (typically 0.25), and a direction (+1/-1), compute a circular arc via sagitta (arc height = chord length * intensity).
3. **Segment sampling**: Each arc is sampled into 16 line segments.
4. **Merged geometry**: All edge polylines are merged into a single BufferGeometry with vertex colors for one draw call.

### Data Structure for Script SOP

For a Script SOP generating all edge polylines in one cook, you need these inputs per edge:

| Field | Type | Source |
|---|---|---|
| source_x, source_y | float | Force simulation positions |
| target_x, target_y | float | Force simulation positions |
| weight (similarity) | float | Graph data |
| direction | int (+1/-1) | Computed from centroid |
| color_r, color_g, color_b | float | Source node color (or edge-specific color) |

**Store as a Table DAT or CHOP:**

```python
# Edge data Table DAT: one row per edge
# Columns: source, target, sx, sy, tx, ty, weight, direction, cr, cg, cb

def update_edge_data(edges, positions, colors_by_node, centroid):
    """
    Compute per-edge rendering data.
    centroid: (cx, cy) global centroid of all node positions.
    """
    edge_dat = op('edge_data')
    edge_dat.clear()
    edge_dat.appendRow([
        'source', 'target', 'sx', 'sy', 'tx', 'ty',
        'weight', 'direction', 'cr', 'cg', 'cb'
    ])

    cx, cy = centroid

    for e in edges:
        sx, sy = positions[e['source']]
        tx, ty = positions[e['target']]

        # Compute outward direction (port of computeOutwardDirection)
        mx = (sx + tx) / 2
        my = (sy + ty) / 2
        outward_x = mx - cx
        outward_y = my - cy

        dx = tx - sx
        dy = ty - sy
        perp_x = -dy
        perp_y = dx

        dot = outward_x * perp_x + outward_y * perp_y
        direction = 1 if dot >= 0 else -1

        # Use source node color for edge
        r, g, b = colors_by_node.get(e['source'], (0.5, 0.5, 0.5))

        edge_dat.appendRow([
            e['source'], e['target'],
            sx, sy, tx, ty,
            e['similarity'], direction,
            r, g, b
        ])
```

### Arc Point Computation in Python

Direct port of `computeArcPoints()` from `edge-curves.ts`:

```python
def compute_arc_points(sx, sy, tx, ty, curve_intensity=0.25, direction=1, segments=16):
    """
    Compute points along a circular arc between two endpoints.
    Port of computeArcPoints() from edge-curves.ts.

    Returns: list of (x, y) tuples from source to target.
    """
    if curve_intensity == 0:
        return [(sx, sy), (tx, ty)]

    dx = tx - sx
    dy = ty - sy
    chord = math.sqrt(dx * dx + dy * dy)

    if chord == 0:
        return [(sx, sy)]

    sagitta = chord * curve_intensity * direction
    abs_sagitta = abs(sagitta)

    if abs_sagitta < 0.1:
        return [(sx, sy), (tx, ty)]

    # Radius from chord and sagitta: r = (L^2/4 + h^2) / (2h)
    radius = (chord * chord / 4 + abs_sagitta * abs_sagitta) / (2 * abs_sagitta)

    # Chord midpoint
    mx = (sx + tx) / 2
    my = (sy + ty) / 2

    # Unit perpendicular to chord
    perp_x = -dy / chord
    perp_y = dx / chord

    # Arc center
    center_offset = radius - abs_sagitta
    sign = -1 if sagitta > 0 else 1
    cx = mx + sign * center_offset * perp_x
    cy = my + sign * center_offset * perp_y

    # Start and end angles from center
    start_angle = math.atan2(sy - cy, sx - cx)
    end_angle = math.atan2(ty - cy, tx - cx)

    # Determine sweep (always minor arc)
    angle_diff = end_angle - start_angle
    while angle_diff > math.pi:
        angle_diff -= 2 * math.pi
    while angle_diff < -math.pi:
        angle_diff += 2 * math.pi

    # Sample points
    points = []
    for i in range(segments + 1):
        t = i / segments
        angle = start_angle + t * angle_diff
        points.append((
            cx + radius * math.cos(angle),
            cy + radius * math.sin(angle),
        ))

    return points
```

### Script SOP: Generating All Edge Polylines

One Script SOP generating all edges in a single cook. Each edge becomes a separate polyline primitive with color and weight attributes:

```python
# Script SOP: edge_geometry
def cook(scriptOp):
    scriptOp.clear()

    # Custom point attributes
    scriptOp.appendPointAttrib('Cd', (1.0, 1.0, 1.0))    # Color
    scriptOp.appendPointAttrib('Alpha', 1.0)               # Edge opacity
    scriptOp.appendPointAttrib('edge_id', 0)               # For picking

    edge_dat = op('edge_data')

    for row in range(1, edge_dat.numRows):
        sx = float(edge_dat[row, 'sx'].val)
        sy = float(edge_dat[row, 'sy'].val)
        tx = float(edge_dat[row, 'tx'].val)
        ty = float(edge_dat[row, 'ty'].val)
        weight = float(edge_dat[row, 'weight'].val)
        direction = int(edge_dat[row, 'direction'].val)
        cr = float(edge_dat[row, 'cr'].val)
        cg = float(edge_dat[row, 'cg'].val)
        cb = float(edge_dat[row, 'cb'].val)

        # Compute arc points
        arc = compute_arc_points(sx, sy, tx, ty,
                                 curve_intensity=0.25,
                                 direction=direction,
                                 segments=16)

        # Create points
        pts = []
        for x, y in arc:
            p = scriptOp.appendPoint()
            p.P = (x, y, 0)
            p.Cd = (cr, cg, cb)
            p.Alpha = weight        # Encode weight as opacity
            p.edge_id = row - 1
            pts.append(p)

        # Create polyline primitive (open, not closed)
        prim = scriptOp.appendPoly(len(pts), closed=False, addPoints=False)
        for p in pts:
            prim.addVertex(p)
```

**Performance**: For 5000 edges x 17 points each = 85,000 points generated in Python. This takes ~50-200ms, which is fine for one-time generation or occasional updates, but not for per-frame regeneration.

### Alternative: GPU-Based Edge Rendering

For per-frame edge updates (e.g., during force simulation), generating polylines in Script SOP every frame is too slow. Two alternatives:

**A. Pre-compute template arc, deform with instance attributes:**

1. Create a template polyline (unit arc from (0,0) to (1,0)) as a SOP
2. Instance it with per-edge transforms (position, rotation, scale)
3. Pass curvature as an instance attribute and deform in vertex shader

```
Template Arc SOP (16-segment unit arc)
  --> Geo COMP (instancing enabled)
      Instance DAT/CHOP: per-edge sx,sy,tx,ty,direction,weight,r,g,b
      --> GLSL MAT (vertex shader deforms arc to match endpoints)
```

**B. GLSL line rendering (most scalable):**

Encode all edge data (endpoints, curvature, color) into textures. Render edge geometry procedurally in a vertex shader that reads from these textures:

1. Create a grid SOP with `E * (S+1)` points (E = edge count, S = segments)
2. In vertex shader, look up edge index and segment index from vertex ID
3. Read endpoint positions from texture, compute arc position per vertex

This approach handles 10,000+ edges at 60fps.

### Edge Data for CHOP-Based Approach

If edges change with the force simulation (positions update each frame but topology stays fixed), split the data:

- **Static**: source/target IDs, weight, color (stored in Table DAT, updated on data load)
- **Dynamic**: source/target positions (stored in CHOP, updated per frame from simulation)

The Script SOP or GLSL MAT reads both: static attributes for curvature and color, dynamic positions for endpoints.

---

## Performance Summary

| Operation | Frequency | Method | Time (2000 nodes) |
|---|---|---|---|
| Supabase fetch | Once / on refresh | requests HTTP | 500-2000ms (network) |
| Embedding storage | Once | numpy array | ~2MB memory |
| Leiden clustering | On resolution change | igraph + leidenalg | 50-150ms |
| Cluster labeling | On cluster change | Claude API (async) | 1-5s per batch |
| PCA color computation | On data load | Python math | ~20ms |
| Hover cosine similarity | Per frame | numpy batch | ~0.01ms |
| Semantic zoom filtering | On zoom end | numpy + Python | ~1-5ms |
| Edge arc generation | On layout change | Script SOP Python | ~100ms (5000 edges) |

**Key principle**: Compute once, render many. Expensive operations (fetch, cluster, color, arc geometry) run on data load or parameter change. Only hover similarity and opacity modulation run per-frame, and numpy makes those fast enough.
