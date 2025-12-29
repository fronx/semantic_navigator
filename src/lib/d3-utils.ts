import * as d3 from "d3";
import { colors } from "./colors";

/** Creates a hover tooltip and returns show/hide controls */
export function createHoverTooltip(
  container: d3.Selection<SVGGElement, unknown, null, undefined>
) {
  const group = container.append("g").style("pointer-events", "none");

  const rect = group
    .append("rect")
    .attr("fill", colors.overlay.background)
    .attr("rx", 4)
    .attr("ry", 4)
    .style("display", "none");

  const text = group
    .append("text")
    .attr("fill", colors.overlay.text)
    .attr("font-size", "28px")
    .attr("font-weight", "500")
    .style("display", "none");

  return {
    show(label: string, x: number, y: number) {
      text.text(label).attr("x", x).attr("y", y).style("display", null);
      const bbox = (text.node() as SVGTextElement).getBBox();
      rect
        .attr("x", bbox.x - 6)
        .attr("y", bbox.y - 2)
        .attr("width", bbox.width + 12)
        .attr("height", bbox.height + 4)
        .style("display", null);
    },
    hide() {
      text.style("display", "none");
      rect.style("display", "none");
    },
  };
}
