import { Image, Text, View, keymap, mount, signal } from "nsh";
import { Button, Editor } from "nsh/base";
import { Application, currentWindow } from "nsh/desktop";
import { readFile, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import process from "process";
import { pathToFileURL } from "url";

type Item = {
  request: string; name: string; size: number; openable: boolean; zh: boolean;
  image?: string; width?: number; height?: number; body?: string; ext?: string; truncated?: boolean;
};
const idleMs = 5000;
const validRequest = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/request\.bcpreview$/;
const validImage = /^image-[0-9a-f]{64}\.(?:jpg|png)$/;
const palette = {
  toolbar: "#191c21", canvas: "#101216", line: "#373d45",
  fg: "#f3f4f6", secondary: "#bac1ca", accent: "#245e59",
};
const icons = {
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="m3 17 5-4 4 3 4-5 5 5"/>',
  "file-text": '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  "external-link": '<path d="M14 4h6v6m0-6-9 9m0-8H4v15h15v-7"/>',
};
function Icon(props: { name: keyof typeof icons; size: number }) {
  const uri = (name: keyof typeof icons) => "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${palette.fg}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`);
  return <Image src={uri(props.name)} style={{width:props.size,height:props.size}}/>;
}

function requestPath(input: string) {
  if (typeof input !== "string" || !process.dataDir) return null;
  const base = process.dataDir.replace(/\\/g, "/") + "/requests/";
  const candidate = input.replace(/\\/g, "/");
  if (!candidate.toLowerCase().startsWith(base.toLowerCase())) return null;
  const relative = candidate.slice(base.length);
  if (!validRequest.test(relative)) return null;
  return join(process.dataDir, "requests", ...relative.split("/"));
}

function mark(request: string, kind: "ready" | "failed" | "open" | "closed" | "recycle") {
  return writeFile(join(dirname(request), kind), "", { flag: "wx" }).catch(() => {});
}

function sizeLabel(size: number) {
  if (size >= 1048576) return `${(size / 1048576).toFixed(1)} MiB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${size} B`;
}

function App() {
  const win = currentWindow();
  const item = signal<Item | null>(null);
  const decoded = new Set<string>();
  let serial = 0, lastRequest = "", timer: ReturnType<typeof setTimeout>;
  let recycle = "";
  function arm() {
    clearTimeout(timer);
    timer = setTimeout(() => Application.quit(), idleMs);
  }
  function dismiss(open = false) {
    ++serial;
    const request = item()?.request;
    item.set(null);
    win.hide();
    arm();
    if (request) void mark(request, open ? "open" : "closed");
  }
  function painted(f: Item) {
    if (item()?.request === f.request) void mark(f.request, "ready");
  }
  function failed(f: Item) {
    if (item()?.request !== f.request) return;
    item.set(null);
    win.hide();
    arm();
    void mark(f.request, "failed");
  }
  async function receive(path: string) {
    const request = requestPath(path);
    if (!request || request === lastRequest) return;
    lastRequest = request;
    const ticket = ++serial;
    try {
      const status = await stat(request);
      if (!status.isFile() || status.size > 1024 * 1024) throw Error("Invalid request");
      const data = JSON.parse(await readFile(request, "utf8"));
      if (typeof data.name !== "string" || data.name.length > 255 ||
          !Number.isSafeInteger(data.size) || data.size < 0 ||
          (data.image !== undefined ? typeof data.image !== "string" || !validImage.test(data.image) :
            typeof data.body !== "string" || data.body.length > 160 * 1024)) throw Error("Invalid request");
      if (ticket !== serial || recycle) return;
      const next: Item = { ...data, request };
      const old = item()?.request;
      // The prebuilt runtime does not expose its process-wide decoded image
      // budget to TSX. Bound that cache by retiring the runner on new images.
      if (next.image && !decoded.has(next.image) && decoded.size >= 4) {
        recycle = request;
        dismiss();
        Application.quit();
        return;
      }
      if (next.image) decoded.add(next.image);
      clearTimeout(timer);
      item.set(next);
      if (old && old !== request) void mark(old, "closed");
      win.set({ title: next.name + " — Better Codex Preview" });
      win.show();
      win.focus();
      if (!next.image) requestAnimationFrame(() => painted(next));
    } catch {
      if (ticket !== serial) return;
      if (!item()) arm();
      void mark(request, "failed");
    }
  }
  Application.on("openFiles", ({ paths }) => { if (paths[0]) void receive(paths[0]); });
  Application.on("secondInstance", ({ args }) => { if (args[0]) void receive(args[0]); });
  Application.on("quit", () => {
    if (recycle) return mark(recycle, "recycle");
    const request = item()?.request;
    if (request) return mark(request, "closed");
  });
  win.set({ closeOnPress: false });
  win.on("closePress", () => dismiss());
  keymap.bind("escape", () => dismiss());
  keymap.bind("space", () => dismiss(), { when: "notEditing" });
  arm();

  return <View style={{flex:1,backgroundColor:palette.canvas}}>
    {() => {
      const f = item();
      if (!f) return null;
      const place = f.openable ? (f.zh ? "打开" : "Open") : (f.zh ? "定位" : "Show file");
      const metadata = [
        f.image ? `${f.width} × ${f.height}` : f.ext?.toUpperCase(),
        sizeLabel(f.size),
        f.truncated ? (f.zh ? "仅预览开头" : "Partial preview") : null,
      ].filter(Boolean).join(" · ");
      return <View style={{flex:1}}>
        <View style={{height:57,flexDirection:"row",alignItems:"center",backgroundColor:palette.toolbar,
          paddingLeft:15,paddingRight:57,gap:9,borderBottomWidth:1,borderColor:palette.line}}>
          <View desktop={{windowDrag:true}} style={{flex:1,minWidth:0,height:"100%",gap:12,flexDirection:"row",alignItems:"center"}}>
            <View style={{width:34,height:34,borderRadius:8,backgroundColor:palette.accent,alignItems:"center",justifyContent:"center"}}>
              <Icon name={f.image ? "image" : "file-text"} size={19}/>
            </View>
            <View style={{flex:1,minWidth:0,gap:2}}>
              <Text style={{fontSize:15,fontWeight:"600",color:palette.fg,numberOfLines:1,textOverflow:"ellipsis-middle"}}>{f.name}</Text>
              <Text style={{fontSize:12,color:palette.secondary,numberOfLines:1}}>{metadata}</Text>
            </View>
          </View>
          <Button accessibilityLabel={place} onPress={() => dismiss(true)}
            style={{height:34,flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:11,borderRadius:7,borderWidth:1,borderColor:"#656b74"}}
            hoverStyle={{backgroundColor:"#2a3038"}}>
            <Icon name="external-link" size={15}/>
            <Text style={{fontSize:13,fontWeight:"500",color:palette.fg}}>{place}</Text>
          </Button>
        </View>
        {f.image ? <View style={{flex:1,padding:20}}>
          <Image src={pathToFileURL(join(dirname(dirname(f.request)),f.image)).href}
            style={{width:"100%",height:"100%",objectFit:"contain"}}
            onLoad={() => painted(f)} onError={() => failed(f)}/>
        </View> : <Editor style={{flex:1,backgroundColor:palette.canvas}} value={f.body ?? ""} language={f.ext || f.name}
          readOnly activeLine={false} scrollBeyondLastLine={false}
          lineNumbers={Boolean(f.ext && !["txt","md","markdown","log"].includes(f.ext))} softWrap/>}
      </View>;
    }}
  </View>;
}
mount(App);
