import { readArtifactJson } from "@/app/artifact/artifact-data";

export const GET = () => readArtifactJson("chunks-embeddings.json");
