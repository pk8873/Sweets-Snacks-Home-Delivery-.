const BASE_URL=(process.env.DJANGO_API_URL||"http://127.0.0.1:8000/whatsapp/api").replace(/\/$/,"");
const SECRET=process.env.WHATSAPP_BOT_SECRET||"";
async function request(path,options={}){const response=await fetch(`${BASE_URL}/${path.replace(/^\//,"")}`,{...options,headers:{"Content-Type":"application/json","X-WhatsApp-Bot-Secret":SECRET,...(options.headers||{})}});const type=response.headers.get("content-type")||"";if(!type.includes("application/json"))throw new Error(`Django API returned ${response.status}`);const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||"Django API request failed.");return data;}
const post=(path,body)=>request(path,{method:"POST",body:JSON.stringify(body)});
export const getCategories=()=>request("categories/");
export const getProducts=id=>request(`products/?category_id=${encodeURIComponent(id)}`);
export const getProduct=id=>post("product/",{product_id:id});
export const searchProducts=q=>post("search/",{q});
export const getCustomer=p=>post("customer/",p);
export const getFavorites=p=>post("favorites/",p);
export const toggleFavorite=p=>post("favorite/toggle/",p);
export const getCart=p=>post("cart/",p);
export const addToCart=p=>post("cart/add/",p);
export const removeCartItem=p=>post("cart/remove/",p);
export const saveAddress=p=>post("address/",p);
export const checkout=p=>post("checkout/",p);
export const getOrders=p=>post("orders/",p);
export const getOrder=p=>post("order/",p);
export const reorder=p=>post("reorder/",p);

// Baileys cannot attach our auth header when it fetches an image URL itself.
// Download the protected image in Node with the secret, then pass the bytes to Baileys.
export const downloadProductImage=async(url)=>{
  if(!url)return null;
  const response=await fetch(url,{headers:{"X-WhatsApp-Bot-Secret":SECRET}});
  if(!response.ok)throw new Error(`Product image request failed: ${response.status}`);
  const type=response.headers.get("content-type")||"image/jpeg";
  if(!type.startsWith("image/"))throw new Error("Product image response is not an image.");
  return Buffer.from(await response.arrayBuffer());
};
