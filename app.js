/* ==========================================================================
   HABIB BRIDAL - INTERACTIVE APP LOGIC
   ========================================================================== */

// Product Catalog — now loaded from Supabase (see supabase_admin_setup.sql
// for the "products" table). Managed from admin.html, not hardcoded here.
let products = [];

// ============================================================================
// SUPABASE SETUP
// The anon/public key below is safe to expose in browser code — it only
// works because Row Level Security policies (see supabase_setup.sql) limit
// exactly what it's allowed to do. Never put a secret/service_role key here.
// ============================================================================
const SUPABASE_URL = "https://htufczscvnegcdvvbkxl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xFlRQG3jsYYyCx3GWTG1Gg_G3kGmRjd";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Anonymous per-browser device ID, used to associate a cart with this browser
// (no login system exists, so this is the "identity" carts sync against).
function getDeviceId() {
  let id = localStorage.getItem("dr_device_id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem("dr_device_id", id);
  }
  return id;
}
const DEVICE_ID = getDeviceId();

// ============================================================================
// WHATSAPP INQUIRY
// Replaces "Add to Bag" across the site: instead of adding to a cart, this
// opens WhatsApp with a pre-filled message containing the product name
// and a direct link to that exact product's page, so the conversation
// starts on WhatsApp with the item already attached (customer asks price there).
// ============================================================================
const WHATSAPP_NUMBER = "923224155224"; // same number used in the footer WhatsApp icon

function buildProductLink(product) {
  const path = `product.html?id=${product.id}`;
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return path;
  }
}

async function askOnWhatsApp(productId) {
  await productsReady;
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const link = buildProductLink(product);
  const message =
    `Hi! I'm interested in this suit:\n\n` +
    `*${product.name}*\n` +
    `${link}`;

  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

// Fetch the product catalog from Supabase. Other functions that need
// `products` (addToCart, filterProducts, etc.) await `productsReady` first
// so they never run against an empty, not-yet-loaded array.
let productsReady = (async () => {
  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .order("id");
    if (error) throw error;

    products = (data || []).map(row => ({
      id: row.id,
      name: row.name,
      category: row.category,
      price: Number(row.price),
      description: row.description || "",
      image: row.image_url,
      link: row.link || null,
      tags: row.tags || [],
      badge: row.badge || null,
      gallery: row.gallery_urls || [],
      rating: row.rating != null ? Number(row.rating) : 5,
      reviewCount: row.review_count != null ? Number(row.review_count) : 0
    }));
  } catch (err) {
    console.error("Failed to load products from Supabase:", err);
    products = [];
  }
})();

// App State
let cart = loadCartCache();

// Fast local cache so the UI has something to show instantly, before the
// Supabase round-trip completes. Supabase is the real source of truth.
function loadCartCache() {
  try {
    const saved = localStorage.getItem("dr_cart_cache");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveCartCache() {
  try {
    localStorage.setItem("dr_cart_cache", JSON.stringify(cart));
  } catch {
    // localStorage unavailable — cache just won't persist across pages
  }
}

let cartSyncTimer = null;
function syncCartToSupabase() {
  clearTimeout(cartSyncTimer);
  // Debounced so rapid +/- clicks don't fire a request per click
  cartSyncTimer = setTimeout(async () => {
    try {
      const { error } = await supabaseClient
        .from("carts")
        .upsert({ device_id: DEVICE_ID, items: cart, updated_at: new Date().toISOString() });
      if (error) throw error;
    } catch (err) {
      console.error("Cart sync to Supabase failed:", err);
    }
  }, 500);
}

async function loadCartFromSupabase() {
  try {
    const { data, error } = await supabaseClient
      .from("carts")
      .select("items")
      .eq("device_id", DEVICE_ID)
      .maybeSingle();
    if (error) throw error;

    if (data && Array.isArray(data.items)) {
      cart = data.items;
      saveCartCache();
      updateCartUI();
    } else {
      // First time this device has been seen — create its row in Supabase.
      syncCartToSupabase();
    }
  } catch (err) {
    console.error("Could not load cart from Supabase, using local cache instead:", err);
  }
}

// DOM Load Initialization
document.addEventListener("DOMContentLoaded", async () => {
  await productsReady;
  renderProducts(products);
  updateCartUI();
  loadCartFromSupabase();
});

// Render Products Grid
function renderProducts(items) {
  const grid = document.getElementById("product-grid");
  if (!grid) return;

  if (items.length === 0) {
    grid.innerHTML = `<p class="no-results">No products found matching your search.</p>`;
    return;
  }

  grid.innerHTML = items.map(p => {
    const tagLabel = p.badge || p.category;
    const detailLink = p.link || `product.html?id=${p.id}`;
    const imageBlock = `
      <div class="product-image-wrap">
        <img src="${p.image}" alt="${p.name}" class="product-image">
        <span class="product-tag">${tagLabel}</span>
      </div>
    `;
    const titleBlock = `<a href="${detailLink}" style="text-decoration: none; color: inherit;">${p.name}</a>`;

    return `
      <div class="product-card">
        <a href="${detailLink}">${imageBlock}</a>
        <div class="product-info">
          <h3 class="product-title">${titleBlock}</h3>
          <button class="add-cart-btn" onclick="askOnWhatsApp(${p.id})">
            <i class="fa-brands fa-whatsapp"></i> Ask on WhatsApp
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Filter Products by Category
function filterProducts(category) {
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => btn.classList.remove('active'));
  if (event && event.target) {
    event.target.classList.add('active');
  }

  if (category === 'all') {
    renderProducts(products);
  } else {
    const filtered = products.filter(p => p.category === category);
    renderProducts(filtered);
  }
}

// Search Products
function searchProducts() {
  const query = document.getElementById("search-input").value.toLowerCase();
  const filtered = products.filter(p => 
    p.name.toLowerCase().includes(query) || 
    p.tags.some(tag => tag.toLowerCase().includes(query))
  );
  renderProducts(filtered);
}

// Shopping Cart Functions
async function addToCart(productId) {
  await productsReady;
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const existingItem = cart.find(item => item.id === productId);
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }

  updateCartUI();
  showToast(`Added "${product.name}" to cart!`);
}

// Add a product to the cart by ID, with an optional quantity.
// Used by product detail pages (e.g. Decor1/2/3.html) via addCurrentProductToCart().
async function addProductById(productId, quantity = 1) {
  await productsReady;
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const existingItem = cart.find(item => item.id === productId);
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    cart.push({ ...product, quantity });
  }

  updateCartUI();
  showToast(`Added "${product.name}" to cart!`);
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  updateCartUI();
}

function updateQuantity(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (item) {
    item.quantity += delta;
    if (item.quantity <= 0) {
      removeFromCart(productId);
    } else {
      updateCartUI();
    }
  }
}

function updateCartUI() {
  saveCartCache();
  syncCartToSupabase();

  const cartCountEl = document.getElementById("cart-count");
  const cartItemsEl = document.getElementById("cart-items");
  const cartSubtotalEl = document.getElementById("cart-subtotal");
  const cartTotalEl = document.getElementById("cart-total");
  const checkoutBtn = document.getElementById("checkout-btn");

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (cartCountEl) cartCountEl.textContent = totalItems;
  if (cartSubtotalEl) cartSubtotalEl.textContent = `PKR ${subtotal.toLocaleString()}`;
  if (cartTotalEl) cartTotalEl.textContent = `PKR ${subtotal.toLocaleString()}`;

  if (checkoutBtn) {
    checkoutBtn.disabled = cart.length === 0;
  }

  if (cartItemsEl) {
    if (cart.length === 0) {
      cartItemsEl.innerHTML = `<p class="empty-cart-msg">Your bag is currently empty.</p>`;
    } else {
      cartItemsEl.innerHTML = cart.map(item => `
        <div class="cart-item">
          <img src="${item.image}" alt="${item.name}" class="cart-item-img">
          <div class="cart-item-details">
            <span class="cart-item-title">${item.name}</span>
            <span class="cart-item-price">PKR ${item.price.toLocaleString()}</span>
            <div class="cart-item-qty">
              <button onclick="updateQuantity(${item.id}, -1)">-</button>
              <span>${item.quantity}</span>
              <button onclick="updateQuantity(${item.id}, 1)">+</button>
            </div>
          </div>
          <button class="remove-item-btn" onclick="removeFromCart(${item.id})">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `).join('');
    }
  }
}

function toggleCartDrawer() {
  const drawer = document.getElementById("cart-drawer");
  if (drawer) drawer.classList.toggle("open");
}

// AI Stylist Chat Drawer
function toggleAiChat() {
  const aiDrawer = document.getElementById("ai-chat-drawer");
  if (aiDrawer) aiDrawer.classList.toggle("open");
}

function handleAiKeyPress(event) {
  if (event.key === "Enter") {
    sendAiMessage();
  }
}

function sendAiMessage() {
  const input = document.getElementById("ai-user-input");
  const messagesContainer = document.getElementById("ai-messages");
  if (!input || !messagesContainer) return;

  const text = input.value.trim();
  if (!text) return;

  // Add User Message
  messagesContainer.innerHTML += `
    <div class="message user-message">${text}</div>
  `;
  input.value = "";
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Simulated AI Stylist Response
  setTimeout(() => {
    let reply = "That's a wonderful choice! How else can I assist you with styling or product recommendations?";
    if (text.toLowerCase().includes("mother") || text.toLowerCase().includes("daughter")) {
      reply = "Our Mother & Daughter sets are designed as matching pairs, perfect for festive get-togethers and family photos!";
    } else if (text.toLowerCase().includes("unstitched") || text.toLowerCase().includes("fabric")) {
      reply = "Our unstitched collection includes premium lawn and embroidered fabric, great for custom tailoring to your fit!";
    } else if (text.toLowerCase().includes("girl")) {
      reply = "Our Girls collection has playful, comfortable outfits perfect for everyday wear and special occasions!";
    } else if (text.toLowerCase().includes("women") || text.toLowerCase().includes("outfit")) {
      reply = "Our Women's collection features elegant stitched pieces perfect for festive and formal occasions!";
    } else if (text.toLowerCase().includes("price") || text.toLowerCase().includes("shipping")) {
      reply = "We offer free delivery across Pakistan for all catalog items!";
    }

    messagesContainer.innerHTML += `
      <div class="message ai-message">${reply}</div>
    `;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, 700);
}

// Send one of the pre-set quick-prompt buttons into the AI chat
function sendQuickPrompt(text) {
  const input = document.getElementById("ai-user-input");
  if (!input) return;
  input.value = text;
  sendAiMessage();
}

/* ==========================================================================
   PAKISTAN PROVINCE / CITY DATA (for checkout address selection)
   ========================================================================== */

const PAKISTAN_LOCATIONS = {
  "Punjab": ["Lahore", "Faisalabad", "Rawalpindi", "Multan", "Gujranwala", "Sialkot", "Bahawalpur", "Sargodha", "Sheikhupura", "Gujrat", "Kasur", "Rahim Yar Khan", "Jhang", "Sahiwal", "Okara", "Dera Ghazi Khan"],
  "Sindh": ["Karachi", "Hyderabad", "Sukkur", "Larkana", "Nawabshah", "Mirpur Khas", "Jacobabad", "Shikarpur", "Khairpur", "Dadu"],
  "Balochistan": ["Quetta", "Gwadar", "Turbat", "Khuzdar", "Chaman", "Sibi", "Zhob", "Hub", "Loralai"],
  "Khyber Pakhtunkhwa": ["Peshawar", "Abbottabad", "Mardan", "Swat (Mingora)", "Kohat", "Bannu", "Dera Ismail Khan", "Mansehra", "Nowshera", "Charsadda"],
  "Gilgit-Baltistan": ["Gilgit", "Skardu", "Hunza", "Ghanche", "Diamer", "Astore"],
  "Azad Kashmir": ["Muzaffarabad", "Mirpur", "Rawalakot", "Bagh", "Kotli", "Bhimber"]
};

function populateProvinces() {
  const provinceSelect = document.getElementById("province-select");
  if (!provinceSelect) return;
  provinceSelect.innerHTML = `<option value="" disabled selected>Select Province</option>` +
    Object.keys(PAKISTAN_LOCATIONS).map(prov => `<option value="${prov}">${prov}</option>`).join('');
}

function populateCities() {
  const provinceSelect = document.getElementById("province-select");
  const citySelect = document.getElementById("city-select");
  if (!provinceSelect || !citySelect) return;

  const province = provinceSelect.value;
  const cities = PAKISTAN_LOCATIONS[province] || [];

  citySelect.innerHTML = `<option value="" disabled selected>Select City</option>` +
    cities.map(city => `<option value="${city}">${city}</option>`).join('');
}

/* ==========================================================================
   CHECKOUT
   ========================================================================== */

function openCheckoutModal() {
  if (cart.length === 0) return;

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const totalEl = document.getElementById("checkout-final-total");
  if (totalEl) totalEl.textContent = `PKR ${subtotal.toLocaleString()}`;

  populateProvinces();

  const modal = document.getElementById("checkout-modal");
  if (modal) modal.classList.add("open");
}

function closeCheckoutModal() {
  const modal = document.getElementById("checkout-modal");
  if (modal) modal.classList.remove("open");
}

async function processOrder(event) {
  event.preventDefault();
  if (cart.length === 0) return;

  const form = event.target;
  const inputs = form.querySelectorAll("input");
  const fullName = inputs[0] ? inputs[0].value : "";
  const phone = inputs[1] ? inputs[1].value : "";

  const streetAddress = document.getElementById("street-address-input")?.value || "";
  const city = document.getElementById("city-select")?.value || "";
  const province = document.getElementById("province-select")?.value || "";
  const address = [streetAddress, city, province].filter(Boolean).join(", ");

  const paymentMethod = "Cash on Delivery (COD)";

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Placing Order...";
  }

  try {
    const { data, error } = await supabaseClient.rpc("place_order", {
      p_full_name: fullName,
      p_phone: phone,
      p_address: address,
      p_payment_method: paymentMethod,
      p_items: cart.map(item => ({ name: item.name, quantity: item.quantity, price: item.price })),
      p_total: subtotal
    });

    if (error) throw error;

    const orderCode = data;

    // Reset cart (locally and in Supabase)
    cart = [];
    updateCartUI();

    form.reset();
    closeCheckoutModal();
    const cartDrawer = document.getElementById("cart-drawer");
    if (cartDrawer) cartDrawer.classList.remove("open");

    showOrderSuccessModal(fullName, orderCode);
  } catch (err) {
    console.error("Order failed:", err);
    showToast("Something went wrong placing your order. Please try again.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm & Place Order";
    }
  }
}

function showOrderSuccessModal(fullName, orderCode) {
  const nameEl = document.getElementById("success-customer-name");
  const codeEl = document.getElementById("success-order-number");
  if (nameEl) nameEl.textContent = fullName || "Customer";
  if (codeEl) codeEl.textContent = orderCode;

  const modal = document.getElementById("order-success-modal");
  if (modal) modal.classList.add("open");
}

function closeOrderSuccessModal() {
  const modal = document.getElementById("order-success-modal");
  if (modal) modal.classList.remove("open");
}

/* ==========================================================================
   ORDER TRACKING
   ========================================================================== */

function toggleTrackingModal() {
  const modal = document.getElementById("tracking-modal");
  if (modal) modal.classList.toggle("open");
}

const TRACKING_STAGES = [
  { key: "placed", label: "Order Placed", icon: "fa-clipboard-check", desc: "We've received your order and it's being confirmed." },
  { key: "processing", label: "Processing", icon: "fa-box-open", desc: "Your items are being carefully packed." },
  { key: "dispatched", label: "Dispatched", icon: "fa-truck-fast", desc: "Your order has left our facility and is on its way." },
  { key: "delivered", label: "Delivered", icon: "fa-house-circle-check", desc: "Your order has arrived. Enjoy!" }
];

async function trackOrder() {
  const input = document.getElementById("tracking-id-input");
  const resultEl = document.getElementById("tracking-result");
  if (!input || !resultEl) return;

  const orderCode = input.value.trim().toUpperCase();
  if (!orderCode) return;

  resultEl.innerHTML = `
    <div class="tracking-msg">
      <i class="fa-solid fa-spinner fa-spin-pulse"></i>
      Looking up your order...
    </div>
  `;

  try {
    const { data, error } = await supabaseClient.rpc("get_order_status", { p_order_code: orderCode });
    if (error) throw error;

    const order = Array.isArray(data) ? data[0] : data;

    if (!order) {
      resultEl.innerHTML = `
        <div class="tracking-msg error-msg">
          <i class="fa-solid fa-magnifying-glass"></i>
          No order found with ID "${orderCode}". Please check the ID and try again.
        </div>
      `;
      return;
    }

    const currentIndex = Math.max(0, TRACKING_STAGES.findIndex(s => s.key === order.status));
    const currentStage = TRACKING_STAGES[currentIndex];
    const isDelivered = currentStage.key === "delivered";

    // Progress line fills up to the midpoint of the current step's icon
    const stepGap = 100 / (TRACKING_STAGES.length - 1);
    const progressPct = currentIndex * stepGap;

    resultEl.innerHTML = `
      <div class="tracking-hero ${isDelivered ? 'is-delivered' : ''}">
        <div class="tracking-hero-icon"><i class="fa-solid ${currentStage.icon}"></i></div>
        <div class="tracking-hero-status">${currentStage.label}</div>
        <p class="tracking-hero-desc">${currentStage.desc}</p>
      </div>

      <div class="tracking-summary">
        <div>
          <div class="tracking-summary-code">Order ${order.order_code}</div>
          <div class="tracking-summary-items">${order.items.map(i => `${i.name} x${i.quantity}`).join(", ")}</div>
        </div>
        <div class="tracking-summary-total">PKR ${Number(order.total).toLocaleString()}</div>
      </div>

      <div class="tracking-timeline">
        <div class="timeline-track"></div>
        <div class="timeline-progress" style="width: ${progressPct}%"></div>
        ${TRACKING_STAGES.map((stage, i) => `
          <div class="track-step ${i < currentIndex ? 'completed' : ''} ${i === currentIndex ? 'completed current' : ''}">
            <div class="step-icon"><i class="fa-solid ${i <= currentIndex ? 'fa-check' : stage.icon}"></i></div>
            <span>${stage.label}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error("Order tracking lookup failed:", err);
    resultEl.innerHTML = `
      <div class="tracking-msg error-msg">
        <i class="fa-solid fa-triangle-exclamation"></i>
        Something went wrong looking up your order. Please try again.
      </div>
    `;
  }
}

/* ==========================================================================
   RETURNS & EXCHANGES
   ========================================================================== */

function toggleReturnModal() {
  const modal = document.getElementById("return-modal");
  if (modal) modal.classList.toggle("open");

  // Reset the form/result back to a clean state every time the modal opens
  const form = document.getElementById("return-form");
  const resultEl = document.getElementById("return-result");
  const errorEl = document.getElementById("return-error-msg");
  if (form) {
    form.reset();
    form.style.display = "";
  }
  if (resultEl) resultEl.innerHTML = "";
  if (errorEl) errorEl.textContent = "";
}

async function submitReturnRequest(event) {
  event.preventDefault();

  const orderCode = document.getElementById("return-order-id").value.trim().toUpperCase();
  const reason = document.getElementById("return-reason").value;
  const details = document.getElementById("return-details").value.trim();
  const fileInput = document.getElementById("return-image-file");
  const file = fileInput.files[0];
  const errorEl = document.getElementById("return-error-msg");
  const submitBtn = document.getElementById("return-submit-btn");

  errorEl.textContent = "";

  if (!file) {
    errorEl.textContent = "Please attach a photo of your order or item.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting...";

  try {
    // 1. Upload the photo to the "return-images" storage bucket
    const fileExt = file.name.split(".").pop();
    const filePath = `${orderCode}-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
    const { error: uploadError } = await supabaseClient
      .storage
      .from("return-images")
      .upload(filePath, file);
    if (uploadError) throw uploadError;

    const { data: urlData } = supabaseClient.storage.from("return-images").getPublicUrl(filePath);
    const imageUrl = urlData.publicUrl;

    // 2. Ask the database to create the return request. The request_return()
    //    function checks the order exists AND that it's within the 7-day
    //    window server-side, so this can't be bypassed from the browser.
    const { error } = await supabaseClient.rpc("request_return", {
      p_order_code: orderCode,
      p_reason: reason,
      p_details: details || null,
      p_image_url: imageUrl
    });
    if (error) throw error;

    // Success — show a confirmation and hide the form
    const form = document.getElementById("return-form");
    if (form) form.style.display = "none";

    document.getElementById("return-result").innerHTML = `
      <div class="tracking-hero is-delivered">
        <div class="tracking-hero-icon"><i class="fa-solid fa-check"></i></div>
        <div class="tracking-hero-status">Return Request Submitted</div>
        <p class="tracking-hero-desc">We've received your return request for order ${orderCode}. Our team will review it and reach out to you shortly.</p>
      </div>
    `;
  } catch (err) {
    console.error("Return request failed:", err);
    const msg = (err && err.message) || "";

    if (msg.includes("RETURN_WINDOW_EXPIRED")) {
      errorEl.textContent = "Sorry, this order is no longer eligible for return. Returns must be requested within 7 days of the order date.";
    } else if (msg.includes("ORDER_NOT_FOUND")) {
      errorEl.textContent = `No order found with ID "${orderCode}". Please check the ID and try again.`;
    } else {
      errorEl.textContent = "Something went wrong submitting your return request. Please try again.";
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Return Request";
  }
}

// Toast Notification Helper
function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}