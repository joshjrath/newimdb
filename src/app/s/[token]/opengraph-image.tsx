import { ImageResponse } from "next/og";
import { getSharedList } from "@/lib/repo/lists";
import { isAllowedPosterUrl } from "@/lib/files/images";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The preview card when the link is pasted into a chat: posters fanned out, and the list name. */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const list = getSharedList((await params).token);
  const posters = (list?.items ?? []).map((i) => i.posterUrl).filter((u): u is string => Boolean(u && isAllowedPosterUrl(u))).slice(0, 5);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "linear-gradient(135deg, #17171b 0%, #24202e 100%)", color: "#fff", padding: 60, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: 560 }}>
          <div style={{ fontSize: 26, color: "#c7b6f6", letterSpacing: 4, textTransform: "uppercase" }}>A list</div>
          <div style={{ fontSize: list && list.name.length > 22 ? 64 : 84, fontWeight: 800, lineHeight: 1.02, marginTop: 12 }}>{list?.name ?? "List"}</div>
          <div style={{ fontSize: 30, color: "rgba(255,255,255,.7)", marginTop: 22 }}>{list ? `${list.count} titles · ${list.finished} watched` : ""}</div>
          <div style={{ display: "flex", marginTop: 30, height: 14, width: 420, background: "rgba(255,255,255,.12)", borderRadius: 99 }}>
            <div style={{ width: `${list?.percent ?? 0}%`, background: "linear-gradient(90deg, #c7b6f6, #57d48c)", borderRadius: 99 }} />
          </div>
        </div>
        <div style={{ display: "flex", position: "relative", flex: 1 }}>
          {posters.map((src, k) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={k} src={src} width={230} height={345} style={{ position: "absolute", left: 20 + k * 62, top: 40 + (k % 2) * 40, borderRadius: 18, transform: `rotate(${(k - 2) * 5}deg)`, boxShadow: "0 20px 40px rgba(0,0,0,.5)" }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
