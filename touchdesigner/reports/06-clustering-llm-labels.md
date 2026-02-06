# TouchDesigner Implementation Analysis: Leiden Clustering & LLM-Based Cluster Labeling

## System Overview

The current system consists of:
1. **Leiden clustering algorithm** - Graph community detection at multiple resolutions (0.1-4.0)
2. **Periphery detection** - Betweenness centrality to identify hub vs extremity clusters
3. **Precomputation** - Clusters computed offline and stored in database
4. **LLM label generation** - Claude Haiku API generates semantic labels
5. **Multi-level caching** - localStorage and database caching
6. **Client-side fallback** - Browser can compute clusters if precomputed data unavailable

## 1. Leiden Algorithm in TouchDesigner

### Python Library Options

**Option A: python-igraph (RECOMMENDED)**

Status: **Fully compatible with TouchDesigner**

- Installation: `pip install python-igraph --target=/path/to/TD/packages`
- API: `import igraph; graph.community_leiden(resolution=1.0)`
- Performance: C backend, O(n log n) complexity
- Features: Built-in Leiden clustering, betweenness centrality
- Proven: Used in Neo4j, Cytoscape, scientific computing

**Implementation example:**
```python
import igraph as ig

g = ig.Graph()
g.add_vertices(len(nodes))
g.add_edges(edges)
g.es["weight"] = edge_weights

communities = g.community_leiden(
    objective_function="modularity",
    weights="weight",
    resolution=1.0
)

centrality = g.betweenness(weights="weight")
cluster_ids = communities.membership
```

**Option B: networkit**
- Pros: Extremely fast (parallelized C++)
- Cons: No native Leiden (only Louvain), overkill for typical graphs

**Recommendation:** Use **python-igraph**

## 2. Pre-computation Strategy

### Option A: External Process (RECOMMENDED)

**Architecture:** Pre-compute clusters in Python script, load results into TD

**Workflow:**
1. Python script (standalone or Node.js):
   - Fetch graph data from Supabase
   - Run Leiden clustering at 8 resolutions
   - Call Claude API for semantic labels
   - Save results to Table DAT file or JSON

2. TouchDesigner on startup:
   - Load precomputed clusters from File DAT or JSON
   - Parse into Table DAT for fast lookup
   - Cache in Storage dictionary

**Advantages:**
- No runtime clustering overhead (instant switching)
- Consistent labels across sessions
- Runs heavy computation offline
- API costs are one-time (~$5 for 8 resolutions × 30 clusters)

**When to re-run:**
- New graph data added
- Graph parameters change
- Cluster labels need updating

### Option B: Runtime Clustering in TouchDesigner

**Advantages:**
- Always matches current graph state
- No separate pre-computation step

**Disadvantages:**
- ~50-100ms clustering time for 1000 nodes (blocks 3-6 frames)
- LLM API calls on every zoom/filter change (expensive)
- Cache complexity in TouchDesigner

**Recommendation:** Use pre-computation unless graph changes constantly

## 3. Data Storage in TouchDesigner

### Recommended Storage Architecture

**Primary storage: Table DAT**

Schema (matching database structure):
```
resolution | node_id           | cluster_id | cluster_label        | hub_node_id       | member_count
-----------|-------------------|------------|----------------------|-------------------|-------------
0.1        | kw:neural network | 5          | machine learning     | kw:deep learning  | 42
1.0        | kw:neural network | 12         | neural architectures | kw:neural network | 18
```

**Access pattern:**
```python
# Get cluster for a node at resolution 1.0
table = op('precomputed_clusters')
for row in table.rows():
    if (float(row[0].val) == resolution and row[1].val == node_id):
        cluster_id = int(row[2].val)
        cluster_label = row[3].val
        break
```

**Optimization: Use Storage dict for fast resolution switching**

```python
# Cache current resolution in Storage
if 'clusters_r1.0' not in op('script1').storage:
    clusters = {}
    table = op('precomputed_clusters')
    for row in table.rows():
        if float(row[0].val) == 1.0:
            clusters[row[1].val] = {
                'cluster_id': int(row[2].val),
                'cluster_label': row[3].val,
                'hub_node_id': row[4].val
            }
    op('script1').storage['clusters_r1.0'] = clusters

# Fast lookup
node_cluster = op('script1').storage['clusters_r1.0']['kw:neural network']
```

**File persistence options:**
1. **JSON File DAT** - Load precomputed JSON on startup
2. **Text DAT with CSV** - Parse CSV into Table DAT
3. **Direct Supabase query** - Use `requests` library

## 4. LLM API Calls from TouchDesigner

### HTTP Requests via Python Script DAT

```python
import requests
import json

def generate_cluster_label(cluster_keywords):
    """
    Call Claude Haiku API to generate semantic label.

    Args:
        cluster_keywords: List of keyword strings

    Returns:
        Semantic label (string)
    """
    api_key = "sk-ant-..."

    payload = {
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 200,
        "messages": [{
            "role": "user",
            "content": f"""Generate a SHORT label (2-4 words) for this keyword cluster:
{', '.join(cluster_keywords[:15])}

Return ONLY the label in lowercase."""
        }]
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }

    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers=headers,
        json=payload,
        timeout=10
    )

    if response.status_code == 200:
        data = response.json()
        for block in data.get("content", []):
            if block.get("type") == "text":
                return block["text"].strip()

    return cluster_keywords[0] if cluster_keywords else "unknown"
```

**Batch API calls** for precomputation provided in full report.

**Error handling:**
```python
try:
    label = generate_cluster_label(keywords)
except requests.exceptions.Timeout:
    label = keywords[0]  # Fallback
except Exception as e:
    label = f"cluster {cluster_id}"
```

## 5. Caching in TouchDesigner

### Multi-Level Caching Strategy

#### Layer 1: Storage Dictionary (in-memory, persistent)

```python
def init_cache(scriptOp):
    if 'cluster_label_cache' not in scriptOp.storage:
        scriptOp.storage['cluster_label_cache'] = {
            'version': 1,
            'entries': []
        }

def cache_label(scriptOp, keywords, centroid, label):
    cache = scriptOp.storage['cluster_label_cache']
    cache['entries'].append({
        'keywords': sorted(keywords),
        'centroid': centroid,
        'label': label,
        'timestamp': tdu.Time()
    })

    # LRU eviction (keep 500 most recent)
    if len(cache['entries']) > 500:
        cache['entries'].sort(key=lambda x: x['timestamp'], reverse=True)
        cache['entries'] = cache['entries'][:500]
```

**Cosine similarity and centroid computation** functions provided in full report.

#### Layer 2: File DAT Persistence

```python
def save_cache_to_file(scriptOp, file_path):
    import json
    cache = scriptOp.storage.get('cluster_label_cache', {})
    with open(file_path, 'w') as f:
        json.dump(cache, f)

def load_cache_from_file(scriptOp, file_path):
    import json
    try:
        with open(file_path, 'r') as f:
            cache = json.load(f)
        scriptOp.storage['cluster_label_cache'] = cache
        return True
    except FileNotFoundError:
        init_cache(scriptOp)
        return False
```

**Persistent storage paths:**
- Project directory: `project.folder`
- Example: `f"{project.folder}/cluster_cache.json"`

## 6. Multi-Resolution Switching

### Implementation Strategy

**Storage structure:** Single Table DAT with all resolutions

```python
def switch_resolution(new_resolution):
    precomputed_resolutions = [0.1, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0]

    nearest = min(precomputed_resolutions,
                  key=lambda r: abs(r - new_resolution))

    if abs(nearest - new_resolution) > 0.15:
        print(f"No precomputed clusters near {new_resolution}")
        return None

    cache_key = f'clusters_r{nearest}'
    if cache_key in op('script1').storage:
        return op('script1').storage[cache_key]

    # First time loading - parse from Table DAT
    clusters = {}
    table = op('precomputed_clusters')
    for row in table.rows():
        if abs(float(row[0].val) - nearest) < 0.01:
            clusters[row[1].val] = {
                'cluster_id': int(row[2].val),
                'cluster_label': row[3].val,
                'hub_node_id': row[4].val
            }

    op('script1').storage[cache_key] = clusters
    return clusters
```

**Performance:** Switching between cached resolutions is instant (<1ms)

## 7. Fallback Strategy

### Option A: Pre-bake All Clusters (RECOMMENDED for TD)

**Strategy:** Always use precomputed data, never compute at runtime

**Advantages:**
- Predictable performance (no frame drops)
- No LLM API calls during performance
- Simpler TD network

**When to use:** Production installations, performances, stable graph

### Option B: Client-Side Clustering Fallback

**Strategy:** Compute clusters in TD if precomputed data missing

```python
import igraph as ig

def compute_clusters_fallback(nodes, edges, resolution):
    """Compute Leiden clusters when precomputed data unavailable"""
    g = ig.Graph()
    node_ids = [n['id'] for n in nodes]
    g.add_vertices(len(node_ids))

    id_to_idx = {nid: i for i, nid in enumerate(node_ids)}
    edge_list = [(id_to_idx[e['source']], id_to_idx[e['target']])
                 for e in edges if e['source'] in id_to_idx]
    weights = [e['similarity'] for e in edges if e['source'] in id_to_idx]

    g.add_edges(edge_list)
    g.es["weight"] = weights

    communities = g.community_leiden(
        objective_function="modularity",
        weights="weight",
        resolution=resolution
    )

    return {node_ids[i]: communities.membership[i]
            for i in range(len(node_ids))}
```

**Performance:** ~50-100ms for 1000 nodes (3-6 frame drop)

## 8. Installation Guide

### Step-by-Step: Setting Up python-igraph

```bash
# 1. Find TD's Python version (print in textport: sys.version)
# Should show: Python 3.11.x

# 2. Install matching Python 3.11 on system

# 3. Create package directory
mkdir ~/TouchDesigner_packages

# 4. Install python-igraph
pip3.11 install python-igraph --target ~/TouchDesigner_packages

# 5. In TouchDesigner:
# Edit → Preferences → DATs → "Python 64-bit Module Path"
# Add: /Users/[you]/TouchDesigner_packages

# 6. Test in TD Textport:
import igraph
print(igraph.__version__)
```

## Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│ PRECOMPUTATION (External, once per graph)      │
├─────────────────────────────────────────────────┤
│ 1. Python script:                               │
│    - Fetch graph from Supabase                  │
│    - Run Leiden clustering (python-igraph)      │
│    - Call Claude API for labels                 │
│    - Export JSON or CSV                         │
│                                                 │
│ 2. TouchDesigner on startup:                    │
│    - File DAT → Load precomputed.json          │
│    - Parse into Table DAT                       │
│    - Cache in Storage dict by resolution        │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ RUNTIME (TouchDesigner)                         │
├─────────────────────────────────────────────────┤
│ 1. User changes zoom/resolution slider         │
│    ↓                                            │
│ 2. Script DAT: switch_resolution(new_res)      │
│    - Find nearest precomputed resolution       │
│    - Load from Storage cache (instant)         │
│    ↓                                            │
│ 3. Update node colors/labels                   │
│    - Assign cluster_id to each node           │
│    - Color by cluster_id                      │
│    - Position cluster labels                   │
└─────────────────────────────────────────────────┘
```

## Summary & Recommendations

| Component | TouchDesigner Solution | Notes |
|-----------|------------------------|-------|
| **Leiden Algorithm** | python-igraph | Install via pip, works in TD Python 3.11 |
| **Precomputation** | External Python script → JSON → File DAT | Run offline, load on startup |
| **Data Storage** | Table DAT + Storage dict | Table for persistence, Storage for speed |
| **LLM API Calls** | requests library in Script DAT | Works reliably, handle timeouts |
| **Caching** | Storage dict (in-memory) + JSON file (disk) | Two-tier cache |
| **Multi-resolution** | Single Table DAT, filter by resolution | Cache each in Storage |
| **Fallback** | **Pre-bake all clusters** (recommended) | Avoid runtime clustering for stable performance |

**Simplest TD Implementation:**
1. Run precomputation script externally
2. Export clusters to JSON
3. In TD: File DAT → Table DAT → Storage dict
4. Script DAT looks up cluster by resolution + node_id
5. No runtime clustering = predictable frame rate
