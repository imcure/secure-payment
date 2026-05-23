(function () {
  "use strict";

  /*
    GitHub Pages configuration:
    - Paste the Google Apps Script Web App /exec URL below.
    - To redeploy safely, edit the EXISTING Apps Script deployment and select "New version".
      Do not create a brand-new deployment unless you also replace this URL.
    - Apps Script Script Properties hold RESEND_API_KEY, ADMIN_EMAIL, and FROM_EMAIL.
  */
  const GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxb3pViOzs7fvKJ7PuuJF64BCDlnBUuWGzk2ZIpPqbMlsdQ4scJhRlXyLH-xTwe7n-q/exec";
  const UPI_ID = "imcure@kotak";
  const UPI_NAME = "IMCure";
  const KYC_PAGE_URL = "https://imcure.github.io/imcure-kyc/";
  const SUBMISSION_COOLDOWN_MS = 8000;
  const BACKEND_TIMEOUT_MS = 6500;
  const BACKEND_RETRY_DELAY_MS = 900;

  const amountFieldGroup = document.getElementById("amountFieldGroup");
  const amountDisplay = document.getElementById("amountDisplay");
  const amountValue = document.getElementById("amountValue");
  const amountInput = document.getElementById("amount");
  const fullNameInput = document.getElementById("fullName");
  const emailInput = document.getElementById("email");
  const phoneInput = document.getElementById("phone");
  const decl1 = document.getElementById("decl1");
  const decl2 = document.getElementById("decl2");
  const paymentActions = document.getElementById("paymentActions");
  const neftBtn = document.getElementById("neftBtn");
  const upiBtn = document.getElementById("upiBtn");
  const popup = document.getElementById("paymentPopup");
  const popupAmount = document.getElementById("popupAmount");
  const popupClose = document.getElementById("popupClose");
  const toastEl = document.getElementById("toast");

  // Exit silently if this page doesn't have the payment form
  if (!neftBtn || !upiBtn || !amountInput) return;

  const amountParam = new URLSearchParams(window.location.search).get("amount");
  const parsedAmount = amountParam ? Number(amountParam) : NaN;

  let paymentAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
  let isSubmitting = false;
  let lastSubmissionAt = 0;

  function log() {
    if (window.console && console.log) {
      console.log.apply(console, ["[IMCure Payment]"].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function warn() {
    if (window.console && console.warn) {
      console.warn.apply(console, ["[IMCure Payment]"].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function showError(id, message) {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
  }

  function clearError(id) {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  }

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

  function getErrorMessage(error) {
    if (!error) return "Something went wrong. Please try again.";
    if (typeof error === "string") return error;
    return error.message || "Something went wrong. Please try again.";
  }

  function hasValidUpiId() {
    return /^[^@\s]+@[^@\s]+$/.test(UPI_ID);
  }

  function hasRequiredBackendConfig() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(GOOGLE_APPS_SCRIPT_URL);
  }

  function setButtonLoading(button, spinnerId, loading) {
    const text = button.querySelector(".pay-btn-text");
    const arrow = button.querySelector(".pay-btn-arrow");
    const spinner = document.getElementById(spinnerId);
    button.disabled = loading;
    neftBtn.disabled = loading;
    upiBtn.disabled = loading;
    text.textContent = loading ? "Processing..." : button.dataset.defaultText;
    arrow.style.display = loading ? "none" : "";
    spinner.style.display = loading ? "" : "none";
  }

  function updatePaymentActionsVisibility() {
    const show = decl1.checked && decl2.checked && Boolean(paymentAmount);
    paymentActions.classList.toggle("is-visible", show);
    paymentActions.setAttribute("aria-hidden", show ? "false" : "true");
  }

  function validateName() {
    const value = fullNameInput.value.trim();
    if (value.length < 2) {
      showError("nameError", "Please enter your full name.");
      setFieldState(fullNameInput, true);
      return false;
    }
    clearError("nameError");
    setFieldState(fullNameInput, false);
    return true;
  }

  function validateEmail() {
    const value = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      showError("emailError", "Please enter a valid email address.");
      setFieldState(emailInput, true);
      return false;
    }
    clearError("emailError");
    setFieldState(emailInput, false);
    return true;
  }

  function validatePhone() {
    const value = phoneInput.value.trim();
    if (!/^[6-9]\d{9}$/.test(value)) {
      showError("phoneError", "Enter a valid 10-digit Indian mobile number.");
      setFieldState(phoneInput, true);
      return false;
    }
    clearError("phoneError");
    setFieldState(phoneInput, false);
    return true;
  }

  function validateAmount() {
    if (paymentAmount) {
      clearError("amountError");
      setFieldState(amountInput, false);
      return true;
    }
    showError("amountError", "Payment amount is missing. Please use the payment link shared with you.");
    setFieldState(amountInput, true);
    return false;
  }

  function validateDeclarations() {
    const valid = decl1.checked && decl2.checked;
    document.getElementById("decl1Box").classList.toggle("is-error", !decl1.checked);
    document.getElementById("decl2Box").classList.toggle("is-error", !decl2.checked);
    if (!valid) {
      showError("declError", "Please accept both declarations to proceed.");
      return false;
    }
    clearError("declError");
    return true;
  }

  function validateAll() {
    return validateAmount() && validateName() && validateEmail() && validatePhone() && validateDeclarations();
  }

  function showPaymentPopup() {
    popupAmount.textContent = formatINR(paymentAmount);
    popup.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  function closePaymentPopup() {
    popup.style.display = "none";
    document.body.style.overflow = "";
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

  function buildSubmission(paymentMode) {
    return {
      submission_id: makeSubmissionId(),
      name: fullNameInput.value.trim(),
      email: emailInput.value.trim(),
      phone: "+91 " + phoneInput.value.trim(),
      phone_raw: phoneInput.value.trim(),
      amount: formatINR(paymentAmount),
      amount_raw: paymentAmount,
      date: getDateOnly(),
      mode: paymentMode,
      payment_mode: paymentMode,
      payment_link: window.location.href,
      timestamp: getTimestamp(),
      status: "Pending"
    };
  }

  function saveCustomerForKyc(submission) {
    const customer = {
      name: submission.name,
      email: submission.email,
      phone: submission.phone_raw,
      amount: submission.amount,
      amount_raw: submission.amount_raw,
      payment_mode: submission.payment_mode,
      payment_submission_id: submission.submission_id,
      payment_timestamp: submission.timestamp,
      saved_at: new Date().toISOString()
    };
    localStorage.setItem("imcure_customer", JSON.stringify(customer));
    localStorage.setItem("imcure_kyc_email", submission.email);
  }

  function goToKyc(submission, delayMs) {
    saveCustomerForKyc(submission);
    const url = new URL(KYC_PAGE_URL, window.location.href);
    url.searchParams.set("payment", "success");
    url.searchParams.set("sid", submission.submission_id);
    window.setTimeout(function () {
      window.location.href = url.toString();
    }, delayMs || 1200);
  }

  function postWithHiddenForm(payload, attempt) {
    return new Promise(function (resolve, reject) {
      const iframeName = "imcure_submission_frame_" + Date.now() + "_" + attempt;
      const iframe = document.createElement("iframe");
      const form = document.createElement("form");
      const input = document.createElement("input");
      let completed = false;
      let submitted = false;

      function cleanup() {
        setTimeout(function () {
          if (form.parentNode) form.parentNode.removeChild(form);
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 500);
      }

      const timer = setTimeout(function () {
        if (completed) return;
        completed = true;
        cleanup();
        reject(new Error("Apps Script submission timed out."));
      }, BACKEND_TIMEOUT_MS);

      iframe.name = iframeName;
      iframe.style.display = "none";
      iframe.onload = function () {
        if (!submitted || completed) return;
        completed = true;
        clearTimeout(timer);
        cleanup();
        resolve({ ok: true, transport: "form", attempt: attempt });
      };

      form.method = "POST";
      form.action = GOOGLE_APPS_SCRIPT_URL;
      form.target = iframeName;
      form.style.display = "none";
      form.enctype = "application/x-www-form-urlencoded";

      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify(payload);
      form.appendChild(input);
      document.body.appendChild(iframe);
      document.body.appendChild(form);

      log("Submitting to Apps Script", { transport: "form", attempt: attempt, submission_id: payload.submission_id });
      submitted = true;
      form.submit();
    });
  }

  function postWithBeacon(payload) {
    if (!navigator.sendBeacon) return false;
    try {
      const body = new URLSearchParams({ payload: JSON.stringify(payload) });
      const ok = navigator.sendBeacon(GOOGLE_APPS_SCRIPT_URL, body);
      log("sendBeacon fallback", { ok: ok, submission_id: payload.submission_id });
      return ok;
    } catch (error) {
      warn("sendBeacon failed", error);
      return false;
    }
  }

  async function postToGoogleAppsScript(payload) {
    /*
      CORS-safe production transport:
      - Do not use normal fetch for Apps Script POST from GitHub Pages.
      - A hidden form/iframe POST avoids preflight and avoids Firefox/Chrome NetworkError issues.
      - Apps Script receives the same JSON inside the form field named "payload".
      - If the iframe does not load in time, the same submission_id is retried once and de-duped by Apps Script.
    */
    if (!hasRequiredBackendConfig()) {
      throw new Error("Paste the Google Apps Script /exec Web App URL in public/app.js.");
    }

    try {
      return await postWithHiddenForm(payload, 1);
    } catch (firstError) {
      warn("First Apps Script submit failed, retrying", firstError);
      await new Promise(function (resolve) { setTimeout(resolve, BACKEND_RETRY_DELAY_MS); });
      try {
        return await postWithHiddenForm(payload, 2);
      } catch (secondError) {
        warn("Second Apps Script submit timed out, using beacon fallback", secondError);
        if (postWithBeacon(payload)) return { ok: true, transport: "beacon" };
        throw secondError;
      }
    }
  }

  async function submitDeclaration(paymentMode) {
    const now = Date.now();
    if (isSubmitting || now - lastSubmissionAt < SUBMISSION_COOLDOWN_MS) {
      throw new Error("Please wait a moment before submitting again.");
    }

    isSubmitting = true;
    lastSubmissionAt = now;

    try {
      const submission = buildSubmission(paymentMode);
      log("Prepared submission", submission);
      await postToGoogleAppsScript(submission);
      log("Backend submission dispatched", { submission_id: submission.submission_id });
      return submission;
    } finally {
      isSubmitting = false;
    }
  }

  function openUpiLink() {
    if (!hasValidUpiId()) {
      toast("UPI ID is not configured. Showing QR instead.", "error", 4000);
      showPaymentPopup();
      return;
    }

    const upiUrl = "upi://pay?pa=" + encodeURIComponent(UPI_ID) + "&pn=" + encodeURIComponent(UPI_NAME) + "&am=" + encodeURIComponent(String(paymentAmount)) + "&cu=INR";
    window.location.href = upiUrl;
    setTimeout(function () {
      if (!document.hidden) showPaymentPopup();
    }, 1800);
  }

  async function handlePayment(method, button, spinnerId) {
    if (!validateAll()) {
      const firstError = document.querySelector(".is-error");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setButtonLoading(button, spinnerId, true);

    try {
      const submission = await submitDeclaration(method);
      if (method === "UPI") {
        toast("Opening payment app. Redirecting to e-KYC after this step...", "success", 3500);
        goToKyc(submission, 6500);
        openUpiLink();
      } else {
        toast("Payment instructions ready. Redirecting to e-KYC...", "success", 3500);
        showPaymentPopup();
        goToKyc(submission, 8500);
      }
    } catch (error) {
      console.error("[IMCure Payment] Backend submission failed", error);
      toast(getErrorMessage(error), "error", 5000);
    } finally {
      setButtonLoading(button, spinnerId, false);
    }
  }

  neftBtn.dataset.defaultText = neftBtn.querySelector(".pay-btn-text").textContent;
  upiBtn.dataset.defaultText = upiBtn.querySelector(".pay-btn-text").textContent;

  if (paymentAmount) {
    // Amount came from URL — show display bar, hide editable field
    amountInput.value = String(paymentAmount);
    amountFieldGroup.style.display = "none";
    amountDisplay.style.display = "flex";
    amountValue.textContent = formatINR(paymentAmount);
  } else {
    // No URL param — let user type the amount manually
    amountFieldGroup.style.display = "block";
    amountDisplay.style.display = "none";
    amountInput.removeAttribute("readonly");
    amountInput.placeholder = "Enter amount (e.g. 20000)";
    amountInput.value = "";
    clearError("amountError");
  }

  // Live-sync typed amount into paymentAmount and the display bar
  amountInput.addEventListener("input", function () {
    var val = Number(amountInput.value);
    if (Number.isFinite(val) && val > 0) {
      paymentAmount = val;
      amountDisplay.style.display = "flex";
      amountValue.textContent = formatINR(val);
      clearError("amountError");
      setFieldState(amountInput, false);
    } else {
      paymentAmount = null;
      amountDisplay.style.display = "none";
      if (amountInput.value !== "") {
        showError("amountError", "Please enter a valid amount.");
        setFieldState(amountInput, true);
      }
    }
    updatePaymentActionsVisibility();
  });

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

  [decl1, decl2].forEach(function (checkbox) {
    checkbox.addEventListener("change", function () {
      checkbox.closest(".declaration-box").classList.toggle("is-checked", checkbox.checked);
      checkbox.closest(".declaration-box").classList.remove("is-error");
      clearError("declError");
      updatePaymentActionsVisibility();
    });
  });

  document.querySelectorAll(".declaration-box").forEach(function (box) {
    box.addEventListener("click", function (event) {
      if (event.target.tagName === "INPUT") return;
      event.preventDefault();
      const checkbox = box.querySelector("input[type='checkbox']");
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  popupClose.addEventListener("click", closePaymentPopup);
  popup.addEventListener("click", function (event) {
    if (event.target === popup) closePaymentPopup();
  });

  neftBtn.addEventListener("click", function () { handlePayment("NEFT / RTGS", neftBtn, "neftSpinner"); });
  upiBtn.addEventListener("click", function () { handlePayment("UPI", upiBtn, "upiSpinner"); });

  log("Loaded", { amount: paymentAmount, backendConfigured: hasRequiredBackendConfig() });
  updatePaymentActionsVisibility();
})();
