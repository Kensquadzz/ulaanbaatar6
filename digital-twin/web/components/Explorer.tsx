"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildingInfo, ImageryMode, LayerKey, PickInfo, Twin as TwinT } from "@/lib/twin";

const TRAFFIC_KEY_STORAGE = "ub3d.tomtomKey";
import { formatArea, formatCoord, search, type SearchItem } from "@/lib/geo";

const LAYERS: { key: LayerKey; label: string; hint?: string }[] = [
  { key: "buildings", label: "Барилга" },
  { key: "unknownHeights", label: "Өндөр тодорхойгүй барилга", hint: "3 м-ийн түр блок" },
  { key: "roads", label: "Зам, төмөр зам" },
  { key: "terrain", label: "Газрын гадарга" },
  { key: "vegetation", label: "Ой, ногоон бүс" },
  { key: "trees", label: "Бүртгэлтэй мод" },
  { key: "water", label: "Гол, ус" },
  { key: "transit", label: "Автобусны буудал" },
  { key: "signals", label: "Гэрлэн дохио (байршил)" },
  { key: "traffic", label: "Замын түгжрэл (live)", hint: "TomTom түлхүүр" },
  { key: "boundaries", label: "Дүүргийн хил" },
];

const IMAGERY: { key: ImageryMode; label: string }[] = [
  { key: "satellite", label: "Хиймэл дагуул (Esri)" },
  { key: "sentinel", label: "Sentinel-2 (10 м)" },
  { key: "map", label: "Газрын зураг (OSM)" },
  { key: "none", label: "Зөвхөн өгөгдөл" },
];

const HS_TEXT: Record<BuildingInfo["heightSource"], string> = {
  source: "Эх сурвалжийн өндөр (OSM)",
  floors: "Тооцоолсон: давхар × 3 м",
  unknown: "Тодорхойгүй: эх сурвалжид өндөр байхгүй, 3 м-ийн түр блокоор харуулав",
};

const TYPE_TEXT: Record<string, string> = { district: "Дүүрэг", building: "Барилга", bus_stop: "Автобусны буудал" };

type Recon = { id: string; name: string; lon: number; lat: number; status: string; method: string; url?: string };

export default function Explorer() {
  const box = useRef<HTMLDivElement>(null);
  const twin = useRef<TwinT | null>(null);
  const [loading, setLoading] = useState("Эхлүүлж байна");
  const [error, setError] = useState("");
  const [panel, setPanel] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() =>
    Object.fromEntries(LAYERS.map((l) => [l.key, l.key !== "traffic"])) as Record<LayerKey, boolean>);
  const [signal, setSignal] = useState<{ kind: string; id: string; lon: number; lat: number } | null>(null);
  const [askKey, setAskKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [trafficAt, setTrafficAt] = useState<Date | null>(null);
  const [imagery, setImagery] = useState<ImageryMode>("satellite");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchItem[]>([]);
  const [building, setBuilding] = useState<BuildingInfo | null>(null);
  const [pick, setPick] = useState<PickInfo | null>(null);
  const [cam, setCam] = useState<(PickInfo & { altitude: number }) | null>(null);
  const [measure, setMeasure] = useState<"distance" | "area" | null>(null);
  const [measureText, setMeasureText] = useState("");
  const [street, setStreet] = useState(false);
  const [recon, setRecon] = useState<Recon[] | null>(null);
  const [showRecon, setShowRecon] = useState(false);
  const [about, setAbout] = useState(false);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    let disposed = false;
    (window as any).CESIUM_BASE_URL = process.env.NEXT_PUBLIC_CESIUM_BASE_URL ?? "/cesium";
    import("@/lib/twin").then(async ({ Twin }) => {
      if (disposed || !box.current) return;
      try {
        const t = new Twin(box.current);
        twin.current = t;
        (window as any).__twin = t;
        t.onPick = (b, p) => { setBuilding(b); setPick(p); };
        t.onMeasure = setMeasureText;
        t.onSignal = setSignal;
        t.onCamera = setCam;
        const q = new URLSearchParams(window.location.search).get("layers");
        await t.loadAll(setLoading, q ? new Set(q.split(",")) : undefined);
        (window as any).__twinReady = true;
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setLoading("");
      }
    });
    fetch("/data/search.json").then((r) => r.json()).then(setIndex).catch(() => {});
    fetch("/data/reconstructions.json").then((r) => r.json()).then((d) => setRecon(d.items ?? [])).catch(() => setRecon([]));
    Promise.all([fetch("/data/manifest.json").then((r) => r.json()), fetch("/data/buildings/tileset.json").then((r) => r.json())])
      .then(([m, ts]) => setStats({ ...m.stats, buildings: ts.extras })).catch(() => {});
    return () => {
      disposed = true;
      twin.current?.destroy();
      twin.current = null;
    };
  }, []);

  // keyboard for street-level walking
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      twin.current?.keyDown(e.code);
    };
    const up = (e: KeyboardEvent) => twin.current?.keyUp(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  const results = useMemo(() => search(index, query, 10), [index, query]);

  const toggle = (k: LayerKey) => {
    const on = !layers[k];
    if (k === "traffic" && on) {
      let key = process.env.NEXT_PUBLIC_TOMTOM_KEY || "";
      try { key = localStorage.getItem(TRAFFIC_KEY_STORAGE) || key; } catch { /* private mode */ }
      if (!key) { setAskKey(true); setPanel(false); return; }
      setTrafficAt(new Date());
    }
    setLayers({ ...layers, [k]: on });
    twin.current?.setLayer(k, on);
  };

  const chooseImagery = (m: ImageryMode) => {
    setImagery(m);
    twin.current?.setImagery(m);
  };

  const go = (it: SearchItem) => {
    twin.current?.flyTo(it.x, it.y, it.t === "district" ? it.b : undefined);
    setQuery("");
  };

  const startMeasure = (m: "distance" | "area") => {
    if (measure === m) {
      twin.current?.clearMeasure();
      setMeasure(null);
      return;
    }
    setMeasure(m);
    twin.current?.startMeasure(m);
    setPanel(false);
  };

  const toggleStreet = () => {
    const on = !street;
    setStreet(on);
    twin.current?.setStreetLevel(on);
    setPanel(false);
  };

  // drag-to-look in street mode
  const lookRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!street) return;
    lookRef.current = { x: e.clientX, y: e.clientY };
  }, [street]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!street || !lookRef.current) return;
    twin.current?.look(e.clientX - lookRef.current.x, e.clientY - lookRef.current.y);
    lookRef.current = { x: e.clientX, y: e.clientY };
  }, [street]);
  const onPointerUp = useCallback(() => { lookRef.current = null; }, []);

  const hold = (f: number, r: number, t: number) => ({
    onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); twin.current?.setStreetMove(f, r, t); },
    onPointerUp: () => twin.current?.setStreetMove(0, 0, 0),
    onPointerLeave: () => twin.current?.setStreetMove(0, 0, 0),
    onPointerCancel: () => twin.current?.setStreetMove(0, 0, 0),
  });

  const coord = pick ?? cam;

  return (
    <div className="fixed inset-0 overflow-hidden select-none">
      <div
        ref={box}
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
        <button
          onClick={() => setPanel(!panel)}
          className="panel pointer-events-auto flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold"
          aria-label="Цэс"
        >
          <span className="text-lg leading-none">☰</span>
          <span className="hidden sm:inline">ULAANBAATAR 3D</span>
        </button>
        <div className="pointer-events-auto relative w-full max-w-md">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Хайх: дүүрэг, газар, барилга, буудал…"
            className="panel h-11 w-full rounded-xl px-4 text-[15px] outline-none placeholder:text-slate-400 focus:border-sky-400"
          />
          {results.length > 0 && (
            <ul className="panel absolute mt-1 max-h-[55vh] w-full overflow-auto rounded-xl py-1 text-sm">
              {results.map((r, i) => (
                <li key={i}>
                  <button onClick={() => go(r)} className="flex w-full items-baseline justify-between gap-3 px-4 py-2 text-left hover:bg-white/10">
                    <span>
                      {r.n}
                      {r.e && <span className="ml-2 text-slate-400">{r.e}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">{TYPE_TEXT[r.t] ?? r.t.replace(/_/g, " ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* side panel */}
      {panel && (
        <div className="panel absolute bottom-16 left-2 top-16 z-10 w-[min(20rem,calc(100vw-1rem))] overflow-auto rounded-2xl p-4 text-sm">
          <Section title="Харагдац">
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => { twin.current?.home(); setPanel(false); }}>Төв талбай</Btn>
              <Btn onClick={() => { twin.current?.wholeCity(); setPanel(false); }}>Бүх хот</Btn>
              <Btn active={street} onClick={toggleStreet}>Гудамжны түвшин</Btn>
              <Btn active={showRecon} onClick={() => { setShowRecon(!showRecon); setPanel(false); }}>3D сэргээлт</Btn>
            </div>
          </Section>
          <Section title="Давхарга">
            {LAYERS.map((l) => (
              <label key={l.key} className="flex cursor-pointer items-center justify-between gap-2 py-1.5">
                <span>
                  {l.label}
                  {l.hint && <span className="ml-1 text-xs text-slate-400">({l.hint})</span>}
                </span>
                <input type="checkbox" className="h-5 w-5 accent-sky-400" checked={layers[l.key]} onChange={() => toggle(l.key)} />
              </label>
            ))}
          </Section>
          <Section title="Суурь зураг">
            {IMAGERY.map((m) => (
              <label key={m.key} className="flex cursor-pointer items-center gap-2 py-1.5">
                <input type="radio" name="img" className="h-4 w-4 accent-sky-400" checked={imagery === m.key} onChange={() => chooseImagery(m.key)} />
                {m.label}
              </label>
            ))}
          </Section>
          <Section title="Хэмжилт">
            <div className="grid grid-cols-2 gap-2">
              <Btn active={measure === "distance"} onClick={() => startMeasure("distance")}>Зай</Btn>
              <Btn active={measure === "area"} onClick={() => startMeasure("area")}>Талбай</Btn>
            </div>
          </Section>
          <Section title="Өнгөний тайлбар">
            <Legend color="#fbf7ef" text="Өндөр нь эх сурвалжаас" />
            <Legend color="#f0cf9c" text="Давхрын тооноос тооцоолсон" />
            <Legend color="#d8d3ca" text="Өндөр тодорхойгүй (3 м блок)" />
          </Section>
          <button onClick={() => { setAbout(true); setPanel(false); }} className="mt-2 w-full rounded-lg bg-white/5 py-2 text-slate-300 hover:bg-white/10">
            Өгөгдлийн эх сурвалж, лиценз
          </button>
        </div>
      )}

      {/* building info */}
      {(building || pick) && !measure && !street && (
        <div className="panel absolute bottom-16 right-2 z-10 w-[min(22rem,calc(100vw-1rem))] rounded-2xl p-4 text-sm">
          <div className="mb-2 flex items-start justify-between gap-2">
            <h2 className="text-base font-semibold">{building ? building.name || "Нэргүй барилга" : "Байршил"}</h2>
            <button className="text-slate-400" onClick={() => { setBuilding(null); setPick(null); twin.current?.clearHighlight(); }}>✕</button>
          </div>
          {building && (
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              <Row k="Төрөл" v={building.cls || "тодорхойгүй"} />
              <Row k="Өндөр" v={building.heightSource === "unknown" ? "тодорхойгүй" : `${building.height} м`} />
              <Row k="Өндрийн эх" v={HS_TEXT[building.heightSource]} />
              {building.floors > 0 && <Row k="Давхар" v={String(building.floors)} />}
              <Row k="Суурийн талбай" v={formatArea(building.area)} />
              {Number.isFinite(building.ground) && <Row k="Газрын өндөр" v={`${building.ground} м (д.т.д., ойролцоо)`} />}
              <Row k="Эх сурвалж" v={building.dataset} />
              <Row k="Overture ID" v={<span className="break-all font-mono text-xs">{building.id}</span>} />
            </dl>
          )}
          {pick && (
            <p className="mt-2 font-mono text-xs text-slate-300">
              {formatCoord(pick.lon, pick.lat)} · {pick.height.toFixed(0)} м
            </p>
          )}
        </div>
      )}

      {/* traffic light info */}
      {signal && !building && (
        <div className="panel absolute bottom-16 right-2 z-10 w-[min(22rem,calc(100vw-1rem))] rounded-2xl p-4 text-sm">
          <div className="mb-2 flex items-start justify-between">
            <h2 className="text-base font-semibold">{signal.kind === "road" ? "Гэрлэн дохио" : "Гэрлэн дохиотой гарц"}</h2>
            <button className="text-slate-400" onClick={() => setSignal(null)}>✕</button>
          </div>
          <p className="text-slate-300">Байршил: OpenStreetMap (Overture). Гэрлийн live төлөв (улаан/шар/ногоон): Улаанбаатарт нээлттэй өгөгдөл байхгүй тул харуулаагүй. Таамаглан анивчуулахгүй.</p>
          <p className="mt-2 font-mono text-xs text-slate-400">{formatCoord(signal.lon, signal.lat)}</p>
        </div>
      )}

      {/* live traffic key prompt */}
      {askKey && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-3" onClick={() => setAskKey(false)}>
          <div className="panel w-full max-w-md rounded-2xl p-5 text-sm leading-relaxed" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-semibold">Замын түгжрэл (live)</h2>
            <p className="text-slate-300">Бодит цагийн түгжрэлийг TomTom Traffic Flow-оос авна. Үнэгүй хувийн түлхүүр хэрэгтэй (developer.tomtom.com). Түлхүүр зөвхөн энэ төхөөрөмжид хадгалагдана.</p>
            <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="TomTom API key"
              className="mt-3 h-11 w-full rounded-lg bg-white/10 px-3 outline-none" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Btn onClick={() => setAskKey(false)}>Болих</Btn>
              <Btn active onClick={() => {
                const k = keyInput.trim();
                if (!k) return;
                try { localStorage.setItem(TRAFFIC_KEY_STORAGE, k); } catch { /* ignore */ }
                setAskKey(false);
                setLayers({ ...layers, traffic: true });
                twin.current?.setLayer("traffic", true);
                setTrafficAt(new Date());
              }}>Хадгалах</Btn>
            </div>
          </div>
        </div>
      )}

      {layers.traffic && trafficAt && (
        <div className="panel absolute right-2 top-16 z-10 rounded-xl px-3 py-2 text-xs">
          <div className="mb-1 font-semibold">Түгжрэл (TomTom, 2 мин тутам)</div>
          <div className="flex items-center gap-1"><span className="h-2 w-6 rounded bg-[#3ddc6a]" />чөлөөтэй
            <span className="ml-2 h-2 w-6 rounded bg-[#ffd23f]" />удаан
            <span className="ml-2 h-2 w-6 rounded bg-[#ff4d4d]" />түгжрэл</div>
        </div>
      )}

      {/* reconstruction mode */}
      {showRecon && (
        <div className="panel absolute bottom-16 right-2 z-10 w-[min(24rem,calc(100vw-1rem))] rounded-2xl p-4 text-sm">
          <div className="mb-2 flex items-start justify-between">
            <h2 className="text-base font-semibold">3D сэргээлтийн горим</h2>
            <button className="text-slate-400" onClick={() => setShowRecon(false)}>✕</button>
          </div>
          {recon && recon.length === 0 && (
            <p className="text-slate-300">
              Одоогоор шалгагдсан AI сэргээлт алга. HY-World 2.0 (WorldMirror 2.0) нь GPU (16–24 ГБ VRAM) болон тухайн газрын
              бодит зураг/видео шаарддаг. Сэргээлт бүр бодит зурагтай харьцуулж шалгагдсаны дараа энд газрын координатаар
              нэмэгдэнэ. Шалгагдаагүй үр дүнг бодит мэт харуулахгүй.
            </p>
          )}
          {recon?.map((r) => (
            <button key={r.id} onClick={() => twin.current?.flyTo(r.lon, r.lat)} className="block w-full rounded-lg px-2 py-2 text-left hover:bg-white/10">
              {r.name} <span className="text-xs text-slate-400">· {r.method} · {r.status}</span>
            </button>
          ))}
        </div>
      )}

      {/* measurement readout */}
      {measure && (
        <div className="panel absolute left-1/2 top-16 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2 text-sm">
          <span>{measureText}</span>
          <button className="rounded-md bg-white/10 px-2 py-1" onClick={() => { twin.current?.clearMeasure(); setMeasure(null); }}>Дуусгах</button>
        </div>
      )}

      {/* street-level controls */}
      {street && (
        <div className="absolute bottom-20 left-1/2 z-10 -translate-x-1/2 text-sm">
          <div className="panel mb-2 rounded-lg px-3 py-1 text-center text-xs text-slate-300">
            Чирж эргэж харна · W A S D / сум · Shift гүйх
          </div>
          <div className="grid grid-cols-3 gap-1">
            <span />
            <Pad {...hold(1, 0, 0)}>▲</Pad>
            <span />
            <Pad {...hold(0, 0, -1)}>⟲</Pad>
            <Pad {...hold(-1, 0, 0)}>▼</Pad>
            <Pad {...hold(0, 0, 1)}>⟳</Pad>
          </div>
          <button onClick={toggleStreet} className="panel mt-2 w-full rounded-lg py-2">Агаараас харах</button>
        </div>
      )}

      {/* status bar */}
      <div className="panel absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[11px] text-slate-300">
        <span className="font-mono">
          {coord ? `${formatCoord(coord.lon, coord.lat)} · ${coord.height.toFixed(0)} м` : "—"}
          {cam && <span className="ml-2 hidden sm:inline">камер {(cam.altitude / 1000).toFixed(2)} км</span>}
        </span>
        <button onClick={() => setAbout(true)} className="shrink-0 underline decoration-dotted">© Overture/OSM · Esri · AWS</button>
      </div>

      {loading && (
        <div className="panel absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-xl px-5 py-3 text-sm">
          Ачаалж байна: {loading}…
        </div>
      )}
      {error && (
        <div className="panel absolute left-1/2 top-1/2 z-20 max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl px-5 py-3 text-sm text-red-300">
          Алдаа: {error}
        </div>
      )}

      {about && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-3" onClick={() => setAbout(false)}>
          <div className="panel max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl p-5 text-sm leading-relaxed" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-semibold">Өгөгдлийн эх сурвалж</h2>
            <p>Байршил, барилга, зам, ус, ургамал, буудал: <b>Overture Maps</b> 2026-10-21.0 (OpenStreetMap ODbL, Microsoft ML Buildings, Google/Microsoft Open Buildings). Хүлээн авсан хэвээр нь, хөдөлгөөгүй.</p>
            <p className="mt-2">Газрын гадарга: <b>AWS Terrain Tiles</b> (SRTM 30 м, GMTED2010), zoom 14. Өндөр нь далайн түвшнээс дээш, ойролцоо.</p>
            <p className="mt-2">Хиймэл дагуулын зураг: Esri World Imagery (Maxar, Earthstar Geographics) эсвэл Sentinel-2 cloudless 2024 (EOX, CC BY-NC-SA 4.0). Газрын зураг: © OpenStreetMap.</p>
            {stats && (
              <ul className="mt-3 list-disc pl-5 text-slate-300">
                <li>Барилга: {stats.buildings?.buildings?.toLocaleString()} (эх сурвалжийн өндөртэй {stats.buildings?.heightSource?.source}, давхраас тооцсон {stats.buildings?.heightSource?.floors}, тодорхойгүй {stats.buildings?.heightSource?.unknown?.toLocaleString()})</li>
                <li>Гол зам, төмөр зам: {stats.main_roads_and_rail?.toLocaleString()}, бусад зам: {stats.detail_roads?.toLocaleString()}</li>
                <li>Ус: {stats.water?.toLocaleString()}, ногоон бүс: {stats.vegetation_areas?.toLocaleString()}, мод: {stats.mapped_trees?.toLocaleString()}</li>
                <li>Автобусны буудал: {stats.transit_stops}, дүүрэг: {stats.districts}</li>
              </ul>
            )}
            <p className="mt-3 text-slate-400">Тодорхойгүй зүйлийг таамаглахгүй, тодорхойгүй гэж тэмдэглэнэ. Нээлттэй эх сурвалжуудад ихэнх барилгын өндөр байхгүй тул 3 м-ийн саарал блокоор харуулсан.</p>
            <button onClick={() => setAbout(false)} className="mt-4 w-full rounded-lg bg-white/10 py-2">Хаах</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

function Btn({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-lg px-3 py-2 text-left ${active ? "bg-sky-500/80 text-white" : "bg-white/5 hover:bg-white/10"}`}>
      {children}
    </button>
  );
}

function Pad(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="panel h-14 w-14 touch-none rounded-xl text-xl active:bg-sky-500/60" />;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-400">{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="h-3 w-5 rounded-sm" style={{ background: color }} />
      {text}
    </div>
  );
}
