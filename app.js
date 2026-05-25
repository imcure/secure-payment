(function () {
  "use strict";

  // ══════════════════════════════════════════════════════════════
  //  CONFIGURATION — edit these three lines
  // ══════════════════════════════════════════════════════════════

  // Your Hostinger domain (no trailing slash)
  // Example: "https://yourdomain.com" or "https://yourdomain.hostinger.app"
  var CASHFREE_BACKEND = "https://imcure.in/cashfree";

  // "sandbox" for testing, "production" for live payments
  var CASHFREE_MODE = "production";

  // Google Apps Script URL (for NEFT logging — keep as is)
  var GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxb3pViOzs7fvKJ7PuuJF64BCDlnBUuWGzk2ZIpPqbMlsdQ4scJhRlXyLH-xTwe7n-q/exec";

  // ══════════════════════════════════════════════════════════════
  //  CONSTANTS
  // ══════════════════════════════════════════════════════════════
  var KYC_PAGE_URL          = "https://imcure.github.io/imcure-kyc/";
  var UPI_ID                = "imcure@kotak";
  var UPI_NAME              = "IMCure";
  var SUBMISSION_COOLDOWN_MS = 8000;
  var BACKEND_TIMEOUT_MS     = 6500;
  var BACKEND_RETRY_DELAY_MS = 900;

  // ══════════════════════════════════════════════════════════════
  //  DOM REFERENCES
  // ══════════════════════════════════════════════════════════════
  var amountFieldGroup = document.getElementById("amountFieldGroup");
  var amountDisplay    = document.getElementById("amountDisplay");
  var amountValue      = document.getElementById("amountValue");
  var amountInput      = document.getElementById("amount");
  var fullNameInput    = document.getElementById("fullName");
  var emailInput       = document.getElementById("email");
  var phoneInput       = document.getElementById("phone");
  var decl1            = document.getElementById("decl1");
  var decl2            = document.getElementById("decl2");
  var paymentActions   = document.getElementById("paymentActions");
  var neftBtn          = document.getElementById("neftBtn");
  var cashfreeBtn      = document.getElementById("cashfreeBtn");
  var upiBtn           = document.getElementById("upiBtn");
  var cashfreeSubtext  = document.getElementById("cashfreeSubtext");
  var popup            = document.getElementById("paymentPopup");
  var popupAmount      = document.getElementById("popupAmount");
  var popupClose       = document.getElementById("popupClose");
  var toastEl          = document.getElementById("toast");

  if (!neftBtn || !cashfreeBtn || !upiBtn || !amountInput) return;

  // ══════════════════════════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════════════════════════
  var amountParam   = new URLSearchParams(window.location.search).get("amount");
  var parsedAmount  = amountParam ? Number(amountParam) : NaN;
  var paymentAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
  var isSubmitting  = false;
  var lastSubmissionAt = 0;
  var pendingSuccessUrl = null;

  // ══════════════════════════════════════════════════════════════
  //  UTILITIES
  // ══════════════════════════════════════════════════════════════
  function log()  { if (window.console && console.log)  console.log.apply(console,  ["[IMCure]"].concat([].slice.call(arguments))); }
  function warn() { if (window.console && console.warn) console.warn.apply(console, ["[IMCure]"].concat([].slice.call(arguments))); }

  function showError(id, msg)  { var el = document.getElementById(id); if (el) el.textContent = msg; }
  function clearError(id)      { var el = document.getElementById(id); if (el) el.textContent = ""; }
  function getErrorMessage(e)  { if (!e) return "Something went wrong. Please try again."; if (typeof e === "string") return e; return e.message || "Something went wrong."; }

  function setFieldState(input, isError) {
    if (!input) return;
    input.classList.toggle("is-error", isError);
    input.classList.toggle("is-valid", !isError && input.value.trim() !== "");
  }

  function formatINR(amount) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  }

  function toast(message, type, duration) {
    toastEl.textContent = message;
    toastEl.className = "toast" + (type ? " toast-" + type : "");
    toastEl.classList.add("show");
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(function () { toastEl.classList.remove("show"); }, duration || 3500);
  }

  function getTimestamp() {
    return new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
  }

  function getDateOnly() {
    return new Date().toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
  }

  function makeSubmissionId() {
    return "imcure_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  }

  // ══════════════════════════════════════════════════════════════
  //  VALIDATION
  // ══════════════════════════════════════════════════════════════
  function validateName() {
    var v = fullNameInput.value.trim();
    if (v.length < 2) { showError("nameError", "Please enter your full name."); setFieldState(fullNameInput, true); return false; }
    clearError("nameError"); setFieldState(fullNameInput, false); return true;
  }

  function validateEmail() {
    var v = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { showError("emailError", "Please enter a valid email address."); setFieldState(emailInput, true); return false; }
    clearError("emailError"); setFieldState(emailInput, false); return true;
  }

  function validatePhone() {
    var v = phoneInput.value.trim();
    if (!/^[6-9]\d{9}$/.test(v)) { showError("phoneError", "Enter a valid 10-digit Indian mobile number."); setFieldState(phoneInput, true); return false; }
    clearError("phoneError"); setFieldState(phoneInput, false); return true;
  }

  function validateAmount() {
    if (paymentAmount) { clearError("amountError"); setFieldState(amountInput, false); return true; }
    showError("amountError", "Payment amount is missing. Please use the payment link shared with you.");
    setFieldState(amountInput, true); return false;
  }

  function validateDeclarations() {
    var valid = decl1.checked && decl2.checked;
    document.getElementById("decl1Box").classList.toggle("is-error", !decl1.checked);
    document.getElementById("decl2Box").classList.toggle("is-error", !decl2.checked);
    if (!valid) { showError("declError", "Please accept both declarations to proceed."); return false; }
    clearError("declError"); return true;
  }

  function validateAll() {
    return validateAmount() && validateName() && validateEmail() && validatePhone() && validateDeclarations();
  }

  // ══════════════════════════════════════════════════════════════
  //  UI HELPERS
  // ══════════════════════════════════════════════════════════════
  function updatePaymentActionsVisibility() {
    var show = decl1.checked && decl2.checked && Boolean(paymentAmount);
    paymentActions.classList.toggle("is-visible", show);
    paymentActions.setAttribute("aria-hidden", show ? "false" : "true");
    if (cashfreeSubtext) cashfreeSubtext.style.display = show ? "block" : "none";
  }

  function setButtonLoading(button, spinnerId, loading) {
    var text    = button.querySelector(".pay-btn-text");
    var arrow   = button.querySelector(".pay-btn-arrow");
    var spinner = document.getElementById(spinnerId);
    neftBtn.disabled     = loading;
    cashfreeBtn.disabled = loading;
    upiBtn.disabled      = loading;
    button.disabled      = loading;
    if (text)    text.textContent = loading ? "Processing…" : button.dataset.defaultText;
    if (arrow)   arrow.style.display = loading ? "none" : "";
    if (spinner) spinner.style.display = loading ? "" : "none";
  }

  function showPaymentPopup() {
    popupAmount.textContent = formatINR(paymentAmount);
    popup.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  function closePaymentPopup() {
    popup.style.display = "none";
    document.body.style.overflow = "";
    if (pendingSuccessUrl) {
      var url = pendingSuccessUrl;
      pendingSuccessUrl = null;
      window.location.replace(url);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  SUBMISSION BUILDER & CUSTOMER STORAGE
  // ══════════════════════════════════════════════════════════════
  function buildSubmission(paymentMode) {
    return {
      submission_id:  makeSubmissionId(),
      name:           fullNameInput.value.trim(),
      email:          emailInput.value.trim(),
      phone:          "+91 " + phoneInput.value.trim(),
      phone_raw:      phoneInput.value.trim(),
      amount:         formatINR(paymentAmount),
      amount_raw:     paymentAmount,
      date:           getDateOnly(),
      mode:           paymentMode,
      payment_mode:   paymentMode,
      payment_link:   window.location.href,
      timestamp:      getTimestamp(),
      status:         "Pending"
    };
  }

  function saveCustomerForKyc(submission) {
    var customer = {
      name:                 submission.name,
      email:                submission.email,
      phone:                submission.phone_raw,
      amount:               submission.amount,
      amount_raw:           submission.amount_raw,
      payment_mode:         submission.payment_mode,
      payment_submission_id: submission.submission_id,
      payment_timestamp:    submission.timestamp,
      saved_at:             new Date().toISOString()
    };
    try {
      localStorage.setItem("imcure_customer", JSON.stringify(customer));
      localStorage.setItem("imcure_kyc_email", submission.email);
    } catch (e) { warn("localStorage write failed", e); }
  }

  // ══════════════════════════════════════════════════════════════
  //  GOOGLE APPS SCRIPT (NEFT logging — hidden form transport)
  // ══════════════════════════════════════════════════════════════
  function hasRequiredBackendConfig() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(GOOGLE_APPS_SCRIPT_URL);
  }

  function postWithHiddenForm(payload, attempt) {
    return new Promise(function (resolve, reject) {
      var iframeName = "imcure_frame_" + Date.now() + "_" + attempt;
      var iframe = document.createElement("iframe");
      var form   = document.createElement("form");
      var input  = document.createElement("input");
      var completed = false, submitted = false;

      function cleanup() { setTimeout(function () { if (form.parentNode) form.parentNode.removeChild(form); if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 500); }

      var timer = setTimeout(function () {
        if (completed) return;
        completed = true; cleanup();
        reject(new Error("Apps Script submission timed out."));
      }, BACKEND_TIMEOUT_MS);

      iframe.name = iframeName; iframe.style.display = "none";
      iframe.onload = function () {
        if (!submitted || completed) return;
        completed = true; clearTimeout(timer); cleanup();
        resolve({ ok: true, transport: "form", attempt: attempt });
      };

      form.method = "POST"; form.action = GOOGLE_APPS_SCRIPT_URL;
      form.target = iframeName; form.style.display = "none";
      form.enctype = "application/x-www-form-urlencoded";

      input.type = "hidden"; input.name = "payload";
      input.value = JSON.stringify(payload);
      form.appendChild(input);
      document.body.appendChild(iframe);
      document.body.appendChild(form);

      submitted = true; form.submit();
    });
  }

  function postWithBeacon(payload) {
    if (!navigator.sendBeacon) return false;
    try {
      var body = new URLSearchParams({ payload: JSON.stringify(payload) });
      return navigator.sendBeacon(GOOGLE_APPS_SCRIPT_URL, body);
    } catch (e) { return false; }
  }

  async function postToGoogleAppsScript(payload) {
    if (!hasRequiredBackendConfig()) throw new Error("Apps Script URL not configured.");
    try {
      return await postWithHiddenForm(payload, 1);
    } catch (e1) {
      warn("Apps Script first attempt failed, retrying", e1);
      await new Promise(function (r) { setTimeout(r, BACKEND_RETRY_DELAY_MS); });
      try {
        return await postWithHiddenForm(payload, 2);
      } catch (e2) {
        if (postWithBeacon(payload)) return { ok: true, transport: "beacon" };
        throw e2;
      }
    }
  }

  async function submitDeclaration(paymentMode) {
    var now = Date.now();
    if (isSubmitting || now - lastSubmissionAt < SUBMISSION_COOLDOWN_MS) {
      throw new Error("Please wait a moment before submitting again.");
    }
    isSubmitting = true; lastSubmissionAt = now;
    try {
      var submission = buildSubmission(paymentMode);
      await postToGoogleAppsScript(submission);
      return submission;
    } finally {
      isSubmitting = false;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  NEFT HANDLER — identical to original behavior
  // ══════════════════════════════════════════════════════════════
  async function handleNeft() {
    if (!validateAll()) {
      var firstError = document.querySelector(".is-error");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setButtonLoading(neftBtn, "neftSpinner", true);
    try {
      var submission = await submitDeclaration("NEFT / RTGS");
      toast("Bank details ready. Close this panel when done to continue.", "success", 4000);
      saveCustomerForKyc(submission);
      pendingSuccessUrl = "success.html?sid=" + encodeURIComponent(submission.submission_id);
      showPaymentPopup();
    } catch (err) {
      toast(getErrorMessage(err), "error", 5000);
    } finally {
      setButtonLoading(neftBtn, "neftSpinner", false);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  UPI HANDLER — opens UPI app with pre-filled amount
  // ══════════════════════════════════════════════════════════════
  function handleUpi() {
    if (!validateAll()) {
      var firstError = document.querySelector(".is-error");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    var submission = buildSubmission("UPI");
    saveCustomerForKyc(submission);

    postToGoogleAppsScript(submission).catch(function (e) {
      warn("Apps Script log failed (non-critical)", e);
    });

    pendingSuccessUrl = "success.html?sid=" + encodeURIComponent(submission.submission_id);

    var upiLink = "upi://pay?pa=" + encodeURIComponent(UPI_ID) +
                  "&pn=" + encodeURIComponent(UPI_NAME) +
                  "&am=" + paymentAmount +
                  "&cu=INR" +
                  "&tn=" + encodeURIComponent("IMCure Payment");

    // Fire the UPI deep link — on mobile this opens the UPI app;
    // on desktop it silently fails (browser ignores unknown protocol).
    var a = document.createElement("a");
    a.href = upiLink;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Show popup immediately — shows QR code for desktop users or
    // as confirmation for mobile users after they finish paying.
    toast("Opening UPI app… or scan the QR code below.", "", 4500);
    showPaymentPopup();
  }

  // ══════════════════════════════════════════════════════════════
  //  CASHFREE HANDLER — new
  // ══════════════════════════════════════════════════════════════
  async function handleCashfreePayment() {
    if (!validateAll()) {
      var firstError = document.querySelector(".is-error");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // Verify Cashfree SDK is loaded
    if (typeof Cashfree === "undefined") {
      toast("Payment SDK not loaded. Please refresh and try again.", "error", 5000);
      return;
    }

    setButtonLoading(cashfreeBtn, "cashfreeSpinner", true);

    try {
      // Build submission record (for our own logs)
      var submission = buildSubmission("Cashfree Online");
      saveCustomerForKyc(submission);

      // Fire-and-forget log to Google Apps Script
      postToGoogleAppsScript(submission).catch(function (e) {
        warn("Apps Script log failed (non-critical)", e);
      });

      // ── Step 1: Create order on Hostinger backend ──────────────
      toast("Creating secure payment order…", "", 8000);

      var res = await fetch(CASHFREE_BACKEND + "/create-order.php", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:          fullNameInput.value.trim(),
          email:         emailInput.value.trim(),
          phone:         phoneInput.value.trim(),
          amount:        paymentAmount,
          submission_id: submission.submission_id
        })
      });

      var data = await res.json();

      if (!res.ok || !data.payment_session_id) {
        throw new Error(data.error || "Could not create payment order. Please try again.");
      }

      log("Order created:", data.order_id);

      // ── Step 2: Open Cashfree hosted checkout ──────────────────
      var cashfree = Cashfree({ mode: CASHFREE_MODE });

      var checkoutOptions = {
        paymentSessionId: data.payment_session_id,
        returnUrl: "https://imcure.github.io/secure-payment/success.html" +
                   "?order_id={order_id}" +
                   "&cf_sid=" + encodeURIComponent(submission.submission_id)
      };

      // This redirects the user to Cashfree — no code runs after this line
      await cashfree.checkout(checkoutOptions);

    } catch (err) {
      console.error("[IMCure Cashfree] Error:", err);
      toast(getErrorMessage(err), "error", 6000);
      setButtonLoading(cashfreeBtn, "cashfreeSpinner", false);
    }
    // Note: do NOT call setButtonLoading(false) here on the happy path —
    // the page navigates away, so it would cause a flash.
  }

  // ══════════════════════════════════════════════════════════════
  //  AMOUNT INITIALISATION
  // ══════════════════════════════════════════════════════════════
  neftBtn.dataset.defaultText      = neftBtn.querySelector(".pay-btn-text").textContent;
  cashfreeBtn.dataset.defaultText  = cashfreeBtn.querySelector(".pay-btn-text").textContent;
  upiBtn.dataset.defaultText       = upiBtn.querySelector(".pay-btn-text").textContent;

  if (paymentAmount) {
    amountInput.value          = String(paymentAmount);
    amountFieldGroup.style.display = "none";
    amountDisplay.style.display    = "flex";
    amountValue.textContent        = formatINR(paymentAmount);
  } else {
    amountFieldGroup.style.display = "block";
    amountDisplay.style.display    = "none";
    amountInput.removeAttribute("readonly");
    amountInput.placeholder = "Enter amount (e.g. 20000)";
    amountInput.value       = "";
    clearError("amountError");
  }

  // Live-sync typed amount
  amountInput.addEventListener("input", function () {
    var val = Number(amountInput.value);
    if (Number.isFinite(val) && val > 0) {
      paymentAmount = val;
      amountDisplay.style.display = "flex";
      amountValue.textContent     = formatINR(val);
      clearError("amountError");
      setFieldState(amountInput, false);
    } else {
      paymentAmount = null;
      amountDisplay.style.display = "none";
      if (amountInput.value !== "") { showError("amountError", "Please enter a valid amount."); setFieldState(amountInput, true); }
    }
    updatePaymentActionsVisibility();
  });

  // ══════════════════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════
  phoneInput.addEventListener("input", function () {
    phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
  });

  [fullNameInput, emailInput, phoneInput].forEach(function (input) {
    input.addEventListener("input", function () {
      if (input === fullNameInput) validateName();
      else if (input === emailInput) validateEmail();
      else validatePhone();
    });
  });

  [decl1, decl2].forEach(function (cb) {
    cb.addEventListener("change", function () {
      cb.closest(".declaration-box").classList.toggle("is-checked", cb.checked);
      cb.closest(".declaration-box").classList.remove("is-error");
      clearError("declError");
      updatePaymentActionsVisibility();
    });
  });

  document.querySelectorAll(".declaration-box").forEach(function (box) {
    box.addEventListener("click", function (e) {
      if (e.target.tagName === "INPUT") return;
      e.preventDefault();
      var cb = box.querySelector("input[type='checkbox']");
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  popupClose.addEventListener("click", closePaymentPopup);
  popup.addEventListener("click", function (e) { if (e.target === popup) closePaymentPopup(); });

  neftBtn.addEventListener("click", handleNeft);
  cashfreeBtn.addEventListener("click", handleCashfreePayment);
  upiBtn.addEventListener("click", handleUpi);

  log("Loaded", { amount: paymentAmount, cashfreeMode: CASHFREE_MODE, backend: CASHFREE_BACKEND });
  updatePaymentActionsVisibility();
})();
