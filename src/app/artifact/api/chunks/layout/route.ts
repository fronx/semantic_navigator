import { readArtifactJson } from "@/app/artifact/artifact-data";

export const GET = () => readArtifactJson("chunks-layout.json");

// No-ops: artifact layout is pre-computed and read-only
export const POST = () => new Response(null, { status: 200 });
export const DELETE = () => new Response(null, { status: 200 });
