const BASE_URL = (process.env.DJANGO_API_URL || "http://127.0.0.1:8000/whatsapp/api").replace(/\/$/, "");
const SECRET = process.env.WHATSAPP_BOT_SECRET || "";

async function request(path, options = {}) {
  const url = `${BASE_URL}/${path.replace(/^\//, "")}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-WhatsApp-Bot-Secret": SECRET,
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Django API returned ${response.status}`);
  }

  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "Django API request failed.");
  }
  return data;
}

const post = (path, body) => request(path, {
  method: "POST",
  body: JSON.stringify(body),
});

export const getCategories = () => request("categories/");
export const getProducts = (categoryId) => request(`products/?category_id=${encodeURIComponent(categoryId)}`);
export const getCustomer = (payload) => post("customer/", payload);
export const getCart = (payload) => post("cart/", payload);
export const addToCart = (payload) => post("cart/add/", payload);
export const removeCartItem = (payload) => post("cart/remove/", payload);
export const saveAddress = (payload) => post("address/", payload);
export const checkout = (payload) => post("checkout/", payload);
export const getOrders = (payload) => post("orders/", payload);
export const getOrder = (payload) => post("order/", payload);
