declare module "troika-three-text" {
  import { Mesh } from "three";

  export class Text extends Mesh {
    text: string;
    fontSize: number;
    color: string | number;
    maxWidth: number;
    textAlign: string;
    anchorX: string | number;
    anchorY: string | number;
    outlineWidth: number | string;
    outlineColor: string | number;
    letterSpacing: number;
    lineHeight: number;
    textSegments?: Array<{ text: string; [key: string]: any }>;
    sync(callback?: () => void): void;
    dispose(): void;
  }
}
