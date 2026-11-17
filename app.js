(() => {
  const cfg = window.HYPREP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const money = (value) => "₦" + Number(value || 0).toLocaleString("en-NG");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const page = document.body.dataset.page || (location.pathname.endsWith("index.html") || location.pathname.endsWith("/") ? "auth" : "");
  let client = null, session = null, isSignup = false, cart = JSON.parse(localStorage.getItem("hyprep_cart") || "[]"), menuCache = [];

  function message(id, text, kind = "") {
    const el = $(id); if (!el) return;
    el.textContent = text || ""; el.className = "notice" + (kind ? " " + kind : "");
  }
  function configReady() {
    return cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY &&
      !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_");
  }
  if (!configReady()) {
    const target = $("authMessage") || $("menuMessage") || $("ordersMessage") || $("adminMessage");
    if (target) message(target.id, "Setup needed: add your Supabase project URL and publishable key in frontend/config.js.", "error");
    return;
  }
  client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    session = data.session;
    return session;
  }
  async function api(path, options = {}) {
    if (!session) await getSession();
    if (!session?.access_token) throw new Error("Please log in again.");
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${session.access_token}` };
    if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const response = await fetch(`${cfg.API_URL}${path}`, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The request could not be completed.");
    return result;
  }
  async function requireLogin() {
    await getSession();
    if (!session) { location.href = "index.html"; return false; }
    const email = $("userEmail"); if (email) email.textContent = session.user.email || "Signed in";
    return true;
  }
  async function logout() {
    await client.auth.signOut();
    localStorage.removeItem("hyprep_cart");
    location.href = "index.html";
  }
  $("logoutBtn")?.addEventListener("click", logout);

  // Sign-in and registration
  if (page === "auth") {
    const form = $("authForm");
    function renderAuthMode() {
      $("authTitle").textContent = isSignup ? "Create your account" : "Welcome back";
      $("authSubtitle").textContent = isSignup ? "Register to start ordering." : "Sign in to continue to your account.";
      $("authSubmit").textContent = isSignup ? "Create account" : "Sign in";
      $("authSwitch").innerHTML = isSignup
        ? 'Already registered? <button type="button" class="text-button" id="toggleAuth">Sign in instead</button>'
        : 'New to HYPREP? <button type="button" class="text-button" id="toggleAuth">Create an account</button>';
    }
    $("authSwitch")?.addEventListener("click", (event) => {
      if (event.target.closest("#toggleAuth")) {
        isSignup = !isSignup;
        renderAuthMode();
        message("authMessage", "");
      }
    });
    form?.addEventListener("submit", async (event) => {
      event.preventDefault(); message("authMessage", "Please wait…");
      const email = $("email").value.trim(), password = $("password").value;
      try {
        if (isSignup) {
          const { data, error } = await client.auth.signUp({ email, password });
          if (error) throw error;
          if (data.session) location.href = "menu.html";
          else message("authMessage", "Account created. Check your email to confirm your account, then sign in.", "success");
        } else {
          const { error } = await client.auth.signInWithPassword({ email, password });
          if (error) throw error;
          await getSession();
          location.href = session.user.app_metadata?.role === "admin" ? "admin.html" : "menu.html";
        }
      } catch (error) { message("authMessage", error.message, "error"); }
    });
    getSession().then(s => { if (s) location.href = s.user.app_metadata?.role === "admin" ? "admin.html" : "menu.html"; }).catch(() => {});
  }

  // Customer menu and cart
  function saveCart() { localStorage.setItem("hyprep_cart", JSON.stringify(cart)); renderCart(); }
  function renderCart() {
    const count = cart.reduce((n, item) => n + item.quantity, 0);
    if ($("cartCount")) $("cartCount").textContent = count;
    if ($("cartSubtext")) $("cartSubtext").textContent = `${count} item${count === 1 ? "" : "s"}`;
    if (!$("cartItems")) return;
    $("cartItems").innerHTML = cart.length ? cart.map(item => `<div class="cart-line"><div><strong>${escapeHtml(item.name)}</strong><small>${money(item.price)} each</small></div><div class="quantity"><button data-cart-minus="${item.id}" aria-label="Decrease">−</button><b>${item.quantity}</b><button data-cart-plus="${item.id}" aria-label="Increase">+</button><button class="remove-btn" data-cart-remove="${item.id}">Remove</button></div><strong>${money(item.price * item.quantity)}</strong></div>`).join("") : '<p class="muted">Your basket is empty.</p>';
    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if ($("cartTotal")) $("cartTotal").textContent = money(total);
    if ($("checkoutTotal")) $("checkoutTotal").textContent = money(total);
    if ($("checkoutBtn")) $("checkoutBtn").disabled = !cart.length;
  }
  function addToCart(food) {
    const existing = cart.find(item => Number(item.id) === Number(food.id));
    if (existing) existing.quantity++;
    else cart.push({ id: food.id, name: food.name, price: Number(food.price), quantity: 1 });
    saveCart(); message("menuMessage", `${food.name} added to your basket.`, "success");
  }
  async function loadMenu() {
    try {
      const params = new URLSearchParams();
      if ($("menuSearch")?.value.trim()) params.set("search", $("menuSearch").value.trim());
      if ($("categoryFilter")?.value) params.set("category", $("categoryFilter").value);
      params.set("available", "false");
      menuCache = await fetch(`${cfg.API_URL}/api/menu?${params}`).then(async r => {
        const data = await r.json(); if (!r.ok) throw new Error(data.error || "Could not load menu."); return data;
      });
      renderMenu(menuCache);
    } catch (error) { message("menuMessage", error.message, "error"); $("foodGrid").innerHTML = '<div class="empty-state">We could not load the menu. Please check that the HYPREP API is running.</div>'; }
  }
  function renderMenu(items) {
    if (!$("foodGrid")) return;
    $("foodGrid").innerHTML = items.length ? items.map(food => `<article class="food-card ${food.is_available ? "" : "unavailable"}"><div class="food-photo">${food.image_url ? `<img src="${escapeHtml(food.image_url)}" alt="${escapeHtml(food.name)}" loading="lazy">` : '<span>H</span>'}${!food.is_available ? '<b class="unavailable-tag">Currently unavailable</b>' : ""}</div><div class="food-info"><span class="food-category">${escapeHtml(food.category || "Menu")}</span><h3>${escapeHtml(food.name)}</h3><div class="food-bottom"><strong>${money(food.price)}</strong><button class="btn btn-dark add-btn" data-add="${food.id}" ${!food.is_available ? "disabled" : ""}>Add to basket <span>+</span></button></div></div></article>`).join("") : '<div class="empty-state">No food items found. Please check back soon.</div>';
  }
  if (page === "menu") {
    requireLogin().then(ok => { if (ok) { loadMenu(); renderCart(); } }).catch(error => message("menuMessage", error.message, "error"));
    $("menuSearch")?.addEventListener("input", loadMenu);
    $("categoryFilter")?.addEventListener("change", loadMenu);
    $("foodGrid")?.addEventListener("click", e => { const btn = e.target.closest("[data-add]"); if (btn) { const food = menuCache.find(x => String(x.id) === btn.dataset.add); if (food) addToCart(food); } });
    $("cartItems")?.addEventListener("click", e => {
      const plus = e.target.closest("[data-cart-plus]"), minus = e.target.closest("[data-cart-minus]"), remove = e.target.closest("[data-cart-remove]");
      const id = plus?.dataset.cartPlus || minus?.dataset.cartMinus || remove?.dataset.cartRemove;
      if (!id) return;
      const item = cart.find(x => String(x.id) === String(id)); if (!item) return;
      if (plus) item.quantity++; if (minus) item.quantity--; if (remove || item.quantity <= 0) cart = cart.filter(x => String(x.id) !== String(id));
      saveCart();
    });
    $("checkoutBtn")?.addEventListener("click", () => { if (!cart.length) return; $("checkoutModal").classList.add("open"); });
    $("closeCheckout")?.addEventListener("click", () => $("checkoutModal").classList.remove("open"));
    $("checkoutModal")?.addEventListener("click", e => { if (e.target.id === "checkoutModal") e.currentTarget.classList.remove("open"); });
    $("checkoutForm")?.addEventListener("submit", async e => {
      e.preventDefault(); message("checkoutMessage", "Placing your order…");
      try {
        const order = await api("/api/orders", { method: "POST", body: JSON.stringify({
          items: cart.map(({ id, quantity }) => ({ id, quantity })),
          address: $("deliveryAddress").value.trim(), phone: $("deliveryPhone").value.trim()
        }) });
        cart = []; saveCart(); $("checkoutForm").reset(); $("checkoutModal").classList.remove("open");
        alert(`Order #${order.id} placed successfully! You can track it under My orders.`);
        location.href = "orders.html";
      } catch (error) { message("checkoutMessage", error.message, "error"); }
    });
  }

  // Customer order history
  if (page === "orders") {
    requireLogin().then(ok => { if (ok) loadCustomerOrders(); }).catch(error => message("ordersMessage", error.message, "error"));
    async function loadCustomerOrders() {
      try {
        const orders = await api("/api/orders");
        $("ordersContainer").innerHTML = orders.length ? orders.map(order => orderCard(order, false)).join("") : '<div class="empty-state"><h3>No orders yet</h3><p>Your placed orders will appear here.</p><a class="btn btn-dark" href="menu.html">Explore menu</a></div>';
      } catch (error) { message("ordersMessage", error.message, "error"); }
    }
    $("ordersContainer")?.addEventListener("click", async e => {
      const edit = e.target.closest("[data-edit-order]"), cancel = e.target.closest("[data-cancel-order]");
      if (edit) {
        const id = edit.dataset.editOrder;
        const address = prompt("Enter your updated delivery address:"); if (address === null) return;
        const phone = prompt("Enter your updated 11-digit phone number:"); if (phone === null) return;
        try { await api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ address, phone }) }); await loadCustomerOrders(); message("ordersMessage", "Delivery details updated.", "success"); }
        catch (error) { message("ordersMessage", error.message, "error"); }
      }
      if (cancel && confirm("Cancel this pending order?")) {
        try { await api(`/api/orders/${cancel.dataset.cancelOrder}`, { method: "DELETE" }); await loadCustomerOrders(); message("ordersMessage", "Order cancelled.", "success"); }
        catch (error) { message("ordersMessage", error.message, "error"); }
      }
    });
  }

  function orderCard(order, admin) {
    const items = Array.isArray(order.items) ? order.items : [];
    const statusClass = String(order.status || "Pending").toLowerCase();
    return `<article class="order-card"><div class="order-head"><div><span class="eyebrow">ORDER #${escapeHtml(order.id)}</span><h3>${new Date(order.created_at).toLocaleString()}</h3></div><span class="status status-${statusClass}">${escapeHtml(order.status)}</span></div><div class="order-items">${items.map(item => `<div><span>${escapeHtml(item.name || "Food item")} × ${Number(item.quantity || 1)}</span><strong>${money(Number(item.price || 0) * Number(item.quantity || 1))}</strong></div>`).join("")}</div><div class="order-details"><p><b>Delivery address</b><br>${escapeHtml(order.address)}</p><p><b>Phone</b><br>${escapeHtml(order.phone)}</p>${admin ? `<p><b>Customer ID</b><br><small>${escapeHtml(order.customer_id)}</small></p>` : ""}</div><div class="order-foot"><strong>Total ${money(order.total)}</strong>${admin ? (order.status === "Cancelled" ? '<span class="muted">Cancelled by customer</span>' : `<div class="status-control"><select data-status-select="${order.id}">${["Pending","Preparing","Delivered"].map(s => `<option ${s === order.status ? "selected" : ""}>${s}</option>`).join("")}</select><button class="btn btn-dark small-btn" data-update-status="${order.id}">Update status</button></div>`) : (order.status === "Pending" ? `<div class="order-actions"><button class="btn btn-outline small-btn" data-edit-order="${order.id}">Edit delivery details</button><button class="btn btn-danger small-btn" data-cancel-order="${order.id}">Cancel order</button></div>` : "")}</div></article>`;
  }

  // Admin console
  if (page === "admin") {
    let editingId = null;
    requireLogin().then(async ok => {
      if (!ok) return;
      if (session.user.app_metadata?.role !== "admin") { message("adminMessage", "Admin access required. Please sign in with the administrator account.", "error"); setTimeout(() => location.href = "menu.html", 1800); return; }
      await loadAdminMenu();
    }).catch(error => message("adminMessage", error.message, "error"));

    async function loadAdminMenu() {
      try {
        const items = await fetch(`${cfg.API_URL}/api/menu`).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not load menu."); return d; });
        $("adminFoodCount").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
        $("adminFoodGrid").innerHTML = items.length ? items.map(food => `<article class="admin-food-card"><div class="admin-food-thumb">${food.image_url ? `<img src="${escapeHtml(food.image_url)}" alt="">` : "H"}</div><div class="admin-food-details"><b>${escapeHtml(food.name)}</b><small>${escapeHtml(food.category)} · ${money(food.price)}</small><span class="availability ${food.is_available ? "yes" : "no"}">${food.is_available ? "Available" : "Unavailable"}</span></div><div class="admin-card-actions"><button class="btn btn-outline small-btn" data-edit-food="${food.id}">Edit</button><button class="btn btn-danger small-btn" data-delete-food="${food.id}">Delete</button><button class="text-button" data-toggle-food="${food.id}" data-available="${food.is_available}">${food.is_available ? "Mark unavailable" : "Make available"}</button></div></article>`).join("") : '<div class="empty-state">No food items have been added yet. Use the form to add your first item.</div>';
      } catch (error) { message("adminMessage", error.message, "error"); }
    }
    $("foodForm")?.addEventListener("submit", async e => {
      e.preventDefault(); message("adminMessage", "Saving food item…");
      try {
        let imageUrl = $("foodImageUrl").value.trim();
        const file = $("foodPhoto").files[0];
        if (file) {
          if (file.size > 2 * 1024 * 1024) throw new Error("Photo must not exceed 2MB.");
          const form = new FormData(); form.append("photo", file);
          const uploaded = await api("/api/menu/upload", { method: "POST", body: form }); imageUrl = uploaded.image_url;
        }
        const payload = { name: $("foodName").value.trim(), price: Number($("foodPrice").value), category: $("foodCategory").value, image_url: imageUrl, is_available: $("foodAvailable").checked };
        await api(editingId ? `/api/menu/${editingId}` : "/api/menu", { method: editingId ? "PATCH" : "POST", body: JSON.stringify(payload) });
        resetFoodForm(); await loadAdminMenu(); message("adminMessage", editingId ? "Food item updated." : "Food item added.", "success");
      } catch (error) { message("adminMessage", error.message, "error"); }
    });
    function resetFoodForm() { editingId = null; $("foodForm").reset(); $("foodId").value = ""; $("foodAvailable").checked = true; $("foodFormTitle").textContent = "Add a food item"; $("saveFoodBtn").textContent = "Save food item"; $("cancelEditBtn").classList.add("hidden"); }
    $("cancelEditBtn")?.addEventListener("click", resetFoodForm);
    $("adminFoodGrid")?.addEventListener("click", async e => {
      const edit = e.target.closest("[data-edit-food]"), del = e.target.closest("[data-delete-food]"), toggle = e.target.closest("[data-toggle-food]");
      try {
        if (edit) {
          const items = await fetch(`${cfg.API_URL}/api/menu`).then(r => r.json());
          const food = items.find(x => String(x.id) === edit.dataset.editFood); if (!food) return;
          editingId = food.id; $("foodId").value = food.id; $("foodName").value = food.name; $("foodPrice").value = food.price;
          $("foodCategory").value = food.category; $("foodImageUrl").value = food.image_url || ""; $("foodAvailable").checked = food.is_available;
          $("foodFormTitle").textContent = "Edit food item"; $("saveFoodBtn").textContent = "Update food item"; $("cancelEditBtn").classList.remove("hidden"); $("foodForm").scrollIntoView({ behavior: "smooth" });
        }
        if (del && confirm("Delete this food item from the menu?")) { await api(`/api/menu/${del.dataset.deleteFood}`, { method: "DELETE" }); await loadAdminMenu(); message("adminMessage", "Food item deleted.", "success"); }
        if (toggle) { await api(`/api/menu/${toggle.dataset.toggleFood}`, { method: "PATCH", body: JSON.stringify({ is_available: toggle.dataset.available !== "true" }) }); await loadAdminMenu(); }
      } catch (error) { message("adminMessage", error.message, "error"); }
    });
    $("showMenuBtn")?.addEventListener("click", () => switchTab("menu"));
    $("showOrdersBtn")?.addEventListener("click", () => { switchTab("orders"); loadAdminOrders(); });
    $("refreshOrdersBtn")?.addEventListener("click", loadAdminOrders);
    function switchTab(which) {
      const menu = which === "menu";
      $("menuManagement").classList.toggle("hidden", !menu);
      $("orderManagement").classList.toggle("hidden", menu);
      $("showMenuBtn").classList.toggle("active", menu);
      $("showOrdersBtn").classList.toggle("active", !menu);
    }
    async function loadAdminOrders() {
      $("adminOrdersList").innerHTML = '<div class="empty-state">Loading orders…</div>';
      try {
        const orders = await api("/api/orders");
        $("adminOrdersList").innerHTML = orders.length ? orders.map(order => orderCard(order, true)).join("") : '<div class="empty-state">There are no customer orders yet.</div>';
      } catch (error) { $("adminOrdersList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
    }
    $("adminOrdersList")?.addEventListener("click", async e => {
      const btn = e.target.closest("[data-update-status]"); if (!btn) return;
      const id = btn.dataset.updateStatus, status = document.querySelector(`[data-status-select="${id}"]`).value;
      try { await api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); await loadAdminOrders(); message("adminMessage", "Order status updated.", "success"); }
      catch (error) { message("adminMessage", error.message, "error"); }
    });
  }
})();