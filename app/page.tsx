"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { enqueueSale, flush, pendingCount } from "../lib/offline-queue";

type Product = { id: string; name: string; price: number; stock: number; low_stock_at: number };
type Customer = { id: string; name: string; owed: number; first_tab_at?: string | null };
type SaleRow = { id: string; total: number | string; created_at: string; sale_items: { qty: number; products: { name: string } | { name: string }[] | null }[] };
const pname = (p: { name: string } | { name: string }[] | null) => (Array.isArray(p) ? p[0]?.name : p?.name) ?? "Item";

const inp = "border-2 border-slate-800 rounded-lg px-3 py-2 text-slate-900 bg-white min-w-0";
const btn = "bg-slate-900 text-white rounded-lg px-4 py-2 font-semibold";
const small = "border-2 border-slate-800 rounded-lg px-3 py-1 font-semibold bg-white text-slate-900";
const card = "bg-white border border-slate-300 rounded-xl p-3 my-2";
const R = (n: number) => "R" + Math.round(n * 100) / 100;

export default function Home() {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [tab, setTab] = useState<"sell" | "tabs" | "stock" | "insights">("sell");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [onTab, setOnTab] = useState(false);
  const [custId, setCustId] = useState("");
  const [sales, setSales] = useState<SaleRow[] | null>(null);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shopName, setShopName] = useState("");
  const [newName, setNewName] = useState("");
  const [payAmt, setPayAmt] = useState<Record<string, string>>({});

  const loadShop = useCallback(async (uid: string) => {
    const { data, error } = await supabase.from("shops").select("id").eq("owner_id", uid).limit(1);
    if (error) { setShopId(localStorage.getItem("tb-shop")); return; }
    const id = data?.[0]?.id ?? null;
    if (id) localStorage.setItem("tb-shop", id);
    setShopId(id);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      let uid = data.session?.user.id ?? null;
      if (uid) localStorage.setItem("tb-user", uid);
      else if (!navigator.onLine) uid = localStorage.getItem("tb-user");
      setUserId(uid);
      if (uid) await loadShop(uid);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      const uid = s?.user.id ?? null;
      if (!uid && !navigator.onLine) return;
      setUserId(uid);
      if (uid) loadShop(uid);
      else setShopId(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadShop]);

  const loadData = useCallback(async () => {
    if (!shopId) return;
    const p = await supabase.from("products").select("*").eq("shop_id", shopId).order("name");
    if (p.data) setProducts(p.data.map((x) => ({ ...x, price: Number(x.price) })));
    else { const k = localStorage.getItem("tb-products"); if (k) setProducts(JSON.parse(k)); }
    const c = await supabase.from("customer_balances").select("id,name,owed,first_tab_at").eq("shop_id", shopId).order("name");
    if (c.data) setCustomers(c.data.map((x) => ({ ...x, owed: Number(x.owed) })));
    else { const k = localStorage.getItem("tb-customers"); if (k) setCustomers(JSON.parse(k)); }
    setPending(await pendingCount());
  }, [shopId]);

  useEffect(() => { loadData(); }, [loadData]);
  const loadSales = useCallback(async () => {
    if (!shopId) return;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data } = await supabase.from("sales").select("id,total,created_at,sale_items(qty,products(name))").eq("shop_id", shopId).gte("created_at", since);
    if (data) { setSales(data as unknown as SaleRow[]); localStorage.setItem("tb-sales", JSON.stringify(data)); }
    else { const k = localStorage.getItem("tb-sales"); if (k) setSales(JSON.parse(k)); }
  }, [shopId]);
  useEffect(() => { if (tab === "insights") loadSales(); }, [tab, loadSales]);
  useEffect(() => { if (products.length) localStorage.setItem("tb-products", JSON.stringify(products)); }, [products]);
  useEffect(() => { if (customers.length) localStorage.setItem("tb-customers", JSON.stringify(customers)); }, [customers]);
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js"); }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = async () => { setOnline(true); await flush(); setMsg(""); loadData(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [loadData]);

  async function auth(mode: "in" | "up") {
    setMsg("");
    const { error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (error) setMsg(error.message);
  }

  async function createShop() {
    if (!shopName.trim()) return;
    const { data, error } = await supabase.from("shops").insert({ name: shopName.trim() }).select("id").single();
    if (error || !data) { setMsg(error?.message ?? "Could not create shop"); return; }
    const demo: [string, number, number][] = [["Bread", 18, 24], ["Milk 1L", 24, 18], ["Maize meal 2kg", 42, 10], ["Airtime R10", 10, 60], ["Cooldrink 500ml", 14, 30]];
    await supabase.from("products").insert(demo.map(([name, price, stock]) => ({ shop_id: data.id, name, price, stock })));
    setShopId(data.id);
  }

  const total = Object.entries(cart).reduce((t, [id, q]) => t + q * (products.find((p) => p.id === id)?.price ?? 0), 0);
  const count = Object.values(cart).reduce((a, b) => a + b, 0);

  async function sell() {
    if (!shopId || !count) return;
    if (onTab && !custId) { setMsg("Pick who this is for"); return; }
    const items = Object.entries(cart).map(([product_id, qty]) => ({
      product_id, qty, unit_price: products.find((p) => p.id === product_id)!.price,
    }));
    await enqueueSale({ shop_id: shopId, customer_id: onTab ? custId : null, total, on_tab: onTab, items });
    setProducts((ps) => ps.map((p) => ({ ...p, stock: p.stock - (cart[p.id] ?? 0) })));
    setCart({}); setOnTab(false); setCustId("");
    setPending(await pendingCount());
    setMsg(navigator.onLine ? "Sale saved " + R(total) : "Saved on this phone. Will sync later.");
    if (navigator.onLine) setTimeout(loadData, 1500);
  }

  async function adjust(p: Product, d: number) {
    const stock = Math.max(0, p.stock + d);
    setProducts((ps) => ps.map((x) => (x.id === p.id ? { ...x, stock } : x)));
    await supabase.from("products").update({ stock }).eq("id", p.id);
  }

  async function addCustomer() {
    if (!newName.trim() || !shopId) return;
    await supabase.from("customers").insert({ shop_id: shopId, name: newName.trim() });
    setNewName(""); loadData();
  }

  async function pay(c: Customer) {
    const v = parseFloat(payAmt[c.id] || "");
    if (!(v > 0) || !shopId) return;
    await supabase.from("payments").insert({ id: crypto.randomUUID(), shop_id: shopId, customer_id: c.id, amount: v });
    setPayAmt({ ...payAmt, [c.id]: "" }); setMsg("Payment recorded " + R(v)); loadData();
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-sky-50 text-slate-900"><div className="max-w-xl mx-auto p-4 pb-40">{children}</div></div>
  );

  if (!ready) return shell(<p>Loading…</p>);

  if (!userId) return shell(
    <>
      <h1 className="text-3xl font-bold">Tabbook</h1>
      <p className="mb-4 text-slate-600">Your shop's ledger. Works with no signal.</p>
      <div className="flex flex-col gap-2">
        <input className={inp} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={inp} type="password" placeholder="Password (6+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex gap-2"><button className={btn} onClick={() => auth("in")}>Sign in</button><button className={small} onClick={() => auth("up")}>Create account</button></div>
        {msg && <p className="text-red-700">{msg}</p>}
      </div>
    </>
  );

  if (!shopId) return shell(
    <>
      <h1 className="text-2xl font-bold mb-2">Name your shop</h1>
      <div className="flex gap-2"><input className={inp + " flex-1"} placeholder="Shop name" value={shopName} onChange={(e) => setShopName(e.target.value)} /><button className={btn} onClick={createShop}>Create shop</button></div>
      {msg && <p className="text-red-700">{msg}</p>}
    </>
  );

  const owing = customers.filter((c) => c.owed > 0);
  return shell(
    <>
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-2xl font-bold">Tabbook</h1>
        <div className="flex gap-2 items-center">
          <span className={"rounded-full border-2 px-3 py-1 text-sm font-semibold " + (online ? "border-green-700 text-green-700" : "border-amber-600 text-amber-700")}>{online ? "Online" : "Offline"}</span>
          <button className={small} onClick={async () => { ["tb-user", "tb-shop", "tb-products", "tb-customers", "tb-sales"].forEach((k) => localStorage.removeItem(k)); await supabase.auth.signOut(); }}>Sign out</button>
        </div>
      </div>
      <div className="flex gap-2 mb-2">
        {(["sell", "tabs", "stock", "insights"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={"flex-1 rounded-lg border-2 border-slate-900 py-2 font-semibold " + (tab === t ? "bg-slate-900 text-white" : "bg-white")}>
            {t === "sell" ? "Sell" : t === "tabs" ? "Tabs" : t === "stock" ? "Stock" : "Insights"}
          </button>
        ))}
      </div>
      {pending > 0 && <div className="border-2 border-dashed border-amber-600 text-amber-700 rounded-lg p-2 my-2 font-semibold">{pending} sale{pending > 1 ? "s" : ""} saved on this phone, waiting to sync</div>}
      {msg && <p className="my-2 font-semibold text-slate-700">{msg}</p>}

      {tab === "sell" && (
        <div className="grid grid-cols-2 gap-2">
          {products.map((p) => {
            const left = p.stock - (cart[p.id] ?? 0);
            return (
              <button key={p.id} disabled={left <= 0} onClick={() => setCart({ ...cart, [p.id]: (cart[p.id] ?? 0) + 1 })}
                className="relative text-left bg-white border-2 border-slate-900 rounded-xl p-3 disabled:opacity-40">
                {cart[p.id] && <span className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full w-6 h-6 text-sm grid place-items-center">{cart[p.id]}</span>}
                <b className="block">{p.name}</b><span className="text-slate-600 text-sm">{R(p.price)} · {left} left</span>
              </button>
            );
          })}
        </div>
      )}

      {tab === "tabs" && (
        <>
          <p className="my-2"><b className="text-red-700">{R(owing.reduce((t, c) => t + c.owed, 0))}</b> out on tabs across {owing.length} customer{owing.length === 1 ? "" : "s"}</p>
          {owing.map((c) => (
            <div key={c.id} className={card}>
              <div className="flex justify-between"><b>{c.name}</b><b className="text-red-700">{R(c.owed)}</b></div>
              <div className="flex gap-2 mt-2"><input className={inp + " flex-1"} type="number" placeholder="Amount paid" value={payAmt[c.id] ?? ""} onChange={(e) => setPayAmt({ ...payAmt, [c.id]: e.target.value })} /><button className={btn} onClick={() => pay(c)}>Record payment</button></div>
            </div>
          ))}
          <h2 className="font-bold mt-4">Add a customer</h2>
          <div className="flex gap-2 mt-1"><input className={inp + " flex-1"} placeholder="Customer name" value={newName} onChange={(e) => setNewName(e.target.value)} /><button className={btn} onClick={addCustomer}>Add customer</button></div>
        </>
      )}

      {tab === "stock" && products.map((p) => (
        <div key={p.id} className={card + " flex justify-between items-center"}>
          <div><b>{p.name}</b><div className="text-sm text-slate-600">{R(p.price)} each</div>{p.stock <= p.low_stock_at && <div className="text-sm text-red-700">Running low. Time to reorder.</div>}</div>
          <div className="flex items-center gap-2"><button className={small} onClick={() => adjust(p, -1)}>−1</button><b className="w-8 text-center">{p.stock}</b><button className={small} onClick={() => adjust(p, 1)}>+1</button><button className={small} onClick={() => adjust(p, 10)}>+10</button></div>
        </div>
      ))}

      {tab === "insights" && (() => {
        const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5); return { l: d.toLocaleDateString("en", { weekday: "short" }), k: d.toDateString(), t: 0 }; });
        const cnt: Record<string, number> = {};
        (sales ?? []).forEach((s) => {
          const d = days.find((x) => x.k === new Date(s.created_at).toDateString());
          if (!d) return;
          d.t += Number(s.total);
          s.sale_items.forEach((i) => { const n = pname(i.products); cnt[n] = (cnt[n] ?? 0) + i.qty; });
        });
        const week = days.reduce((a, d) => a + d.t, 0);
        const max = Math.max(1, ...days.map((d) => d.t));
        const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3);
        const low = products.filter((p) => p.stock <= p.low_stock_at);
        const late = customers.filter((c) => c.owed > 0 && c.first_tab_at && Date.now() - new Date(c.first_tab_at).getTime() >= 7 * 864e5);
        return (
          <>
            {sales === null && <p className="my-2 text-slate-600">Connect to the internet once to load your insights.</p>}
            <div className="border-l-4 border-red-600 bg-white rounded-r-lg p-3 my-3">
              You sold <b>{R(week)}</b> this week{top[0] ? ", led by " + top[0][0] : ""}. {low.length > 0 && "Reorder " + low.map((p) => p.name).join(" and ") + " soon. "}{late.length > 0 && late.map((c) => c.name).join(" and ") + (late.length > 1 ? " have" : " has") + " owed you for over a week."}
            </div>
            <div className={card}>
              <div className="flex justify-between text-sm text-slate-600"><span>Sales, last 7 days</span><b className="text-slate-900">{R(week)}</b></div>
              <div className="flex items-end gap-2 h-32 mt-2">
                {days.map((d) => (
                  <div key={d.k} className="flex-1 h-full flex flex-col justify-end text-center text-xs text-slate-600">
                    <div className="bg-slate-900 rounded-t-md min-h-[3px]" style={{ height: Math.round((d.t / max) * 100) + "%" }} />{d.l}
                  </div>
                ))}
              </div>
            </div>
            <div className={card}><b>Best sellers</b>{top.length ? top.map((t) => <div key={t[0]} className="flex justify-between"><span>{t[0]}</span><b>{t[1]} sold</b></div>) : <div className="text-slate-600">No sales yet.</div>}</div>
            <div className={card}><b>Low stock</b>{low.length ? low.map((p) => <div key={p.id} className="flex justify-between"><span>{p.name}</span><b className="text-red-700">{p.stock} left</b></div>) : <div className="text-slate-600">Shelves look good.</div>}</div>
            <div className={card}><b>Late payers</b>{late.length ? late.map((c) => <div key={c.id} className="flex justify-between"><span>{c.name}</span><b className="text-red-700">{R(c.owed)}</b></div>) : <div className="text-slate-600">Nobody is late.</div>}</div>
          </>
        );
      })()}

      {tab === "sell" && count > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-4 border-slate-900 p-3">
          <div className="max-w-xl mx-auto flex flex-col gap-2">
            <div className="flex justify-between"><b>{count} item{count > 1 ? "s" : ""} · {R(total)}</b><button className={small} onClick={() => setCart({})}>Clear</button></div>
            <div className="flex gap-2 items-center">
              <button className={onTab ? small : btn} onClick={() => setOnTab(false)}>Paid</button>
              <button className={onTab ? btn : small} onClick={() => setOnTab(true)}>Put on tab</button>
              {onTab && <select className={inp + " flex-1"} value={custId} onChange={(e) => setCustId(e.target.value)}><option value="">Who for?</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
              <button className={btn + " ml-auto"} onClick={sell}>Record sale</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
