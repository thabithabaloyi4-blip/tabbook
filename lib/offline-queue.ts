   import { get, set } from "idb-keyval";
   import { supabase } from "./supabase";

   export type PendingSale = {
     id: string;
     shop_id: string;
     customer_id: string | null;
     total: number;
     on_tab: boolean;
     created_at: string;
     items: { product_id: string; qty: number; unit_price: number }[];
   };

   const KEY = "pending-sales";
   let flushing = false;

   export async function pendingCount(): Promise<number> {
     return ((await get<PendingSale[]>(KEY)) ?? []).length;
   }

   export async function enqueueSale(sale: Omit<PendingSale, "id" | "created_at">) {
     const full: PendingSale = { ...sale, id: crypto.randomUUID(), created_at: new Date().toISOString() };
     const queue = (await get<PendingSale[]>(KEY)) ?? [];
     await set(KEY, [...queue, full]);
     if (navigator.onLine) void flush();
     return full;
   }

   export async function flush(): Promise<number> {
     if (flushing) return pendingCount();
     flushing = true;
     try {
       const queue = (await get<PendingSale[]>(KEY)) ?? [];
       const left: PendingSale[] = [];
       for (const sale of queue) {
         const { error } = await supabase.rpc("record_sale", { p: sale });
         if (error) left.push(sale);
       }
       await set(KEY, left);
       return left.length;
     } finally {
       flushing = false;
     }
   }

   if (typeof window !== "undefined") {
     window.addEventListener("online", () => void flush());
   }