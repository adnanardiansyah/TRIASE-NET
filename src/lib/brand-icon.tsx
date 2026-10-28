import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Render the same symbol framing as Brand, using the supplied artwork unchanged.
export async function renderBrandIcon(size: number) {
  const image = await readFile(join(process.cwd(), "public/images/triase-student-services.png"));
  return new ImageResponse(
    <div style={{ display: "flex", width: size, height: size * 0.95, position: "relative", overflow: "hidden" }}>
      {/* ImageResponse requires an embedded image, rather than next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`data:image/png;base64,${image.toString("base64")}`} alt="" width={size * 2.46} height={size * 1.64} style={{ position: "absolute", left: -size * 0.69, top: -size * 0.15 }} />
    </div>,
    { width: size, height: size },
  );
}
