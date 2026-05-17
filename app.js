(function () {
  "use strict";

  const GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxb3pViOzs7fvKJ7PuuJF64BCDlnBUuWGzk2ZIpPqbMlsdQ4scJhRlXyLH-xTwe7n-q/exec";
  const UPI_ID = "imcure@kotak";
  const UPI_NAME = "IMCure";
  const KYC_PAGE_URL = "https://imcure.github.io/imcure-kyc/";
  const SUBMISSION_COOLDOWN_MS = 8000;
  const BACKEND_TIMEOUT_MS = 6500;
  const BACKEND_RETRY_DELAY_MS = 900;
  const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

  const amountFieldGroup = document.getElementById("amountFieldGroup");
  const amountDisplay = document.getElementById("amountDisplay");
  const amountValue = document.getElementById("amountValue");
  const amountInput = document.getElementById("amount");
  const fullNameInput = document.getElementById("fullName");
  const emailInput = document.getElementById("email");
  const phoneInput = document.getElementById("phone");
  const utrInput = document.getElementById("utr");
  const screenshotInput = document.getElementById("paymentScreenshot");
  const uploadBox = document.getElementById("uploadBox");
  const uploadTitle = document.getElementById("uploadTitle");
  const decl1 = document.getElementById("decl1");
  const decl2 = document.getElementById("decl2");
  const continueToPaymentBtn = document.getElementById("continueToPaymentBtn");
  const continueToSubmitBtn = document.getElementById("continueToSubmitBtn");
  const submitConfirmationBtn = document.getElementById("submitConfirmationBtn");
  const submitSpinner = document.getElementById("submitSpinner");
  const submitText = submitConfirmationBtn.querySelector(".submit-text");
  const neftBtn = document.getElementById("neftBtn");
  const upiBtn = document.getElementById("upiBtn");
  const popup = document.getElementById("paymentPopup");
  const popupAmount = document.getElementById("popupAmount");
  const popupClose = document.getElementById("popupClose");
  const paymentDoneBtn = document.getElementById("paymentDoneBtn");
  const toastEl = document.getElementById("toast");
  const reviewBox = document.getElementById("reviewBox");
  const form = document.getElementById("paymentForm");
  const amountParam = new URLSearchParams(window.location.search).get("amount");
  const parsedAmount = amountParam ? Number(amountParam) : NaN;

  let paymentAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
  let selectedPaymentMode = "";
  let paymentWasStarted = false;
  let isSubmitting = false;
  let lastSubmissionAt = 0;
  let screenshotDataUrl = "";

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
    toastEl._timer = setTimeout(function () { toastEl.classList.remove("show"); }, duration || 3600);
  }

  function setStep(step) {
    document.querySelectorAll(".flow-step").forEach(function (el) {
      const isCurrent = Number(el.dataset.step) === step;
      el.classList.toggle("is-current", isCurrent);
      el.setAttribute("aria-hidden", isCurrent ? "false" : "true");
    });

    document.querySelectorAll(".progress-step").forEach(function (el, index) {
      const stepNumber = index + 1;
      el.classList.toggle("is-active", stepNumber === step);
      el.classList.toggle("is-complete", stepNumber < step);
    });

    const current = document.querySelector(".flow-step.is-current");
    if (current) current.scrollIntoView({ behavior: "smooth", block: "start" });
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

  function validateDetails() {
    return validateAmount() && validateName() && validateEmail() && validatePhone() && validateDeclarations();
  }

  function validateUtr() {
    const value = utrInput.value.trim();
    if (value && value.length < 4) {
      showError("utrError", "Please enter a complete payment reference or leave it blank.");
      setFieldState(utrInput, true);
      return false;
    }
    clearError("utrError");
    setFieldState(utrInput, false);
    return true;
  }

  function validateScreenshot() {
    const file = screenshotInput.files && screenshotInput.files[0];
    if (!paymentWasStarted) {
      showError("screenshotError", "Please complete payment first.");
      return false;
    }
    if (!file) {
      showError("screenshotError", "Please upload the payment screenshot or receipt.");
      uploadBox.classList.add("is-error");
      return false;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      showError("screenshotError", "File must be 8 MB or smaller.");
      uploadBox.classList.add("is-error");
      return false;
    }
    clearError("screenshotError");
    uploadBox.classList.remove("is-error");
    uploadBox.classList.add("has-file");
    return true;
  }

  function showPaymentPopup() {
    popupAmount.textContent = formatINR(paymentAmount);
    popup.style.display = "flex";
    popup.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closePaymentPopup() {
    popup.style.display = "none";
    popup.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function markPaymentComplete() {
    paymentWasStarted = true;
    closePaymentPopup();
    setStep(3);
    toast("Payment noted. Upload the screenshot to submit confirmation.", "success");
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

  function makeApplicationId() {
    return "IMC" + Date.now().toString().slice(-7);
  }

  function buildSubmission() {
    const file = screenshotInput.files && screenshotInput.files[0];
    return {
      submission_id: makeSubmissionId(),
      application_id: makeApplicationId(),
      name: fullNameInput.value.trim(),
      email: emailInput.value.trim().toLowerCase(),
      phone: "+91 " + phoneInput.value.trim(),
      phone_raw: phoneInput.value.trim(),
      amount: formatINR(paymentAmount),
      amount_raw: paymentAmount,
      date: getDateOnly(),
      mode: selectedPaymentMode,
      payment_mode: selectedPaymentMode,
      payment_link: window.location.href,
      timestamp: getTimestamp(),
      status: "Pending",
      utr: utrInput.value.trim().toUpperCase(),
      screenshot_attached: Boolean(file),
      screenshot_name: file ? file.name : "",
      screenshot_size: file ? file.size : "",
      screenshot_type: file ? file.type : "",
      screenshot_data_url: screenshotDataUrl,
      consent_declaration: "accepted",
      source: "static_secure_payment_v4"
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
      application_id: submission.application_id,
      payment_timestamp: submission.timestamp,
      saved_at: new Date().toISOString()
    };
    localStorage.setItem("imcure_customer", JSON.stringify(customer));
    localStorage.setItem("imcure_kyc_email", submission.email);
    localStorage.setItem("imcure_last_payment_submission", JSON.stringify(submission));
  }

  function goToKyc(submission, delayMs) {
    saveCustomerForKyc(submission);
    const url = new URL(KYC_PAGE_URL, window.location.href);
    url.searchParams.set("payment", "success");
    url.searchParams.set("sid", submission.submission_id);
    url.searchParams.set("app", submission.application_id);
    window.setTimeout(function () {
      window.location.href = url.toString();
    }, delayMs || 1300);
  }

  function hasValidUpiId() {
    return /^[^@\s]+@[^@\s]+$/.test(UPI_ID);
  }

  function hasRequiredBackendConfig() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(GOOGLE_APPS_SCRIPT_URL);
  }

  function getErrorMessage(error) {
    if (!error) return "Something went wrong. Please try again.";
    if (typeof error === "string") return error;
    return error.message || "Something went wrong. Please try again.";
  }

  function postWithHiddenForm(payload, attempt) {
    return new Promise(function (resolve, reject) {
      const iframeName = "imcure_submission_frame_" + Date.now() + "_" + attempt;
      const iframe = document.createElement("iframe");
      const hiddenForm = document.createElement("form");
      const input = document.createElement("input");
      let completed = false;
      let submitted = false;

      function cleanup() {
        setTimeout(function () {
          if (hiddenForm.parentNode) hiddenForm.parentNode.removeChild(hiddenForm);
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

      hiddenForm.method = "POST";
      hiddenForm.action = GOOGLE_APPS_SCRIPT_URL;
      hiddenForm.target = iframeName;
      hiddenForm.style.display = "none";
      hiddenForm.enctype = "application/x-www-form-urlencoded";

      input.type = "hidden";
      input.name = "payload";
      input.value = JSON.stringify(payload);
      hiddenForm.appendChild(input);
      document.body.appendChild(iframe);
      document.body.appendChild(hiddenForm);

      log("Submitting to Apps Script", { transport: "form", attempt: attempt, submission_id: payload.submission_id });
      submitted = true;
      hiddenForm.submit();
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
    if (!hasRequiredBackendConfig()) {
      throw new Error("Google Apps Script Web App URL is not configured.");
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

  function readScreenshotFile() {
    return new Promise(function (resolve, reject) {
      const file = screenshotInput.files && screenshotInput.files[0];
      if (!file) {
        resolve("");
        return;
      }
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read uploaded screenshot. Please try again.")); };
      reader.readAsDataURL(file);
    });
  }

  async function submitConfirmation() {
    const now = Date.now();
    if (isSubmitting || now - lastSubmissionAt < SUBMISSION_COOLDOWN_MS) {
      throw new Error("Please wait a moment before submitting again.");
    }

    isSubmitting = true;
    lastSubmissionAt = now;

    try {
      screenshotDataUrl = await readScreenshotFile();
      const submission = buildSubmission();
      log("Prepared submission", {
        submission_id: submission.submission_id,
        mode: submission.payment_mode,
        screenshot_name: submission.screenshot_name
      });
      await postToGoogleAppsScript(submission);
      log("Backend submission dispatched", { submission_id: submission.submission_id });
      return submission;
    } finally {
      isSubmitting = false;
    }
  }

  function setSubmitLoading(loading) {
    submitConfirmationBtn.disabled = loading;
    submitText.textContent = loading ? "Submitting..." : "Submit Confirmation";
    submitSpinner.style.display = loading ? "" : "none";
  }

  function setPaymentButtonLoading(button, spinnerId, loading) {
    const text = button.querySelector(".pay-btn-text");
    const arrow = button.querySelector(".pay-btn-arrow");
    const spinner = document.getElementById(spinnerId);
    button.disabled = loading;
    text.textContent = loading ? "Opening..." : button.dataset.defaultText;
    arrow.style.display = loading ? "none" : "";
    spinner.style.display = loading ? "" : "none";
  }

  function openUpiLink() {
    if (!hasValidUpiId()) {
      toast("UPI ID is not configured. Showing QR instead.", "error", 4200);
      showPaymentPopup();
      return;
    }

    const upiUrl = "upi://pay?pa=" + encodeURIComponent(UPI_ID) + "&pn=" + encodeURIComponent(UPI_NAME) + "&am=" + encodeURIComponent(String(paymentAmount)) + "&cu=INR";
    window.location.href = upiUrl;
    setTimeout(function () {
      if (!document.hidden) showPaymentPopup();
    }, 1200);
  }

  function startPayment(method, button, spinnerId) {
    selectedPaymentMode = method;
    setPaymentButtonLoading(button, spinnerId, true);
    window.setTimeout(function () {
      setPaymentButtonLoading(button, spinnerId, false);
      if (method === "UPI") {
        toast("Opening UPI. Return here after payment to upload proof.", "success", 4200);
        openUpiLink();
      } else {
        toast("Bank transfer details are ready.", "success");
        showPaymentPopup();
      }
    }, 260);
  }

  function renderReview() {
    const file = screenshotInput.files && screenshotInput.files[0];
    const rows = [
      ["Name", fullNameInput.value.trim()],
      ["Email", emailInput.value.trim().toLowerCase()],
      ["Phone", "+91 " + phoneInput.value.trim()],
      ["Amount", formatINR(paymentAmount)],
      ["Mode", selectedPaymentMode],
      ["Reference", utrInput.value.trim().toUpperCase() || "Not provided"],
      ["Screenshot", file ? file.name : "Missing"]
    ];

    reviewBox.innerHTML = rows.map(function (row) {
      return '<div class="review-row"><span>' + escapeHtml(row[0]) + '</span><strong>' + escapeHtml(row[1]) + '</strong></div>';
    }).join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function initAmount() {
    if (paymentAmount) {
      amountInput.value = String(paymentAmount);
      amountFieldGroup.style.display = "none";
      amountDisplay.style.display = "flex";
      amountValue.textContent = formatINR(paymentAmount);
      return;
    }

    amountFieldGroup.style.display = "block";
    amountDisplay.style.display = "none";
    amountInput.value = "";
    showError("amountError", "Payment amount is missing. Please use the payment link shared with you.");
    setFieldState(amountInput, true);
  }

  function bindEvents() {
    phoneInput.addEventListener("input", function () {
      phoneInput.value = phoneInput.value.replace(/\D/g, "").slice(0, 10);
      validatePhone();
    });

    fullNameInput.addEventListener("input", validateName);
    emailInput.addEventListener("input", validateEmail);
    utrInput.addEventListener("input", function () {
      utrInput.value = utrInput.value.toUpperCase();
      validateUtr();
    });

    [decl1, decl2].forEach(function (checkbox) {
      checkbox.addEventListener("change", function () {
        checkbox.closest(".declaration-box").classList.toggle("is-checked", checkbox.checked);
        checkbox.closest(".declaration-box").classList.remove("is-error");
        clearError("declError");
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

    screenshotInput.addEventListener("change", function () {
      const file = screenshotInput.files && screenshotInput.files[0];
      screenshotDataUrl = "";
      if (!file) {
        uploadTitle.textContent = "Choose screenshot or receipt";
        uploadBox.classList.remove("has-file");
        return;
      }
      uploadTitle.textContent = file.name;
      validateScreenshot();
    });

    continueToPaymentBtn.addEventListener("click", function () {
      if (!validateDetails()) {
        const firstError = document.querySelector(".is-error");
        if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
        toast("Please fix the highlighted details.", "error");
        return;
      }
      setStep(2);
      toast("Details verified. Choose a payment option.", "success");
    });

    neftBtn.addEventListener("click", function () { startPayment("NEFT / RTGS", neftBtn, "neftSpinner"); });
    upiBtn.addEventListener("click", function () { startPayment("UPI", upiBtn, "upiSpinner"); });

    popupClose.addEventListener("click", closePaymentPopup);
    popup.addEventListener("click", function (event) {
      if (event.target === popup) closePaymentPopup();
    });
    paymentDoneBtn.addEventListener("click", markPaymentComplete);

    continueToSubmitBtn.addEventListener("click", function () {
      if (!validateUtr() || !validateScreenshot()) {
        toast("Please add your payment proof before continuing.", "error");
        return;
      }
      renderReview();
      setStep(4);
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!validateDetails() || !validateUtr() || !validateScreenshot()) {
        toast("Please review the highlighted fields.", "error");
        return;
      }

      setSubmitLoading(true);
      try {
        const submission = await submitConfirmation();
        toast("Confirmation submitted. Redirecting to e-KYC...", "success", 4200);
        goToKyc(submission, 1300);
      } catch (error) {
        console.error("[IMCure Payment] Backend submission failed", error);
        toast(getErrorMessage(error), "error", 5200);
      } finally {
        setSubmitLoading(false);
      }
    });
  }

  neftBtn.dataset.defaultText = neftBtn.querySelector(".pay-btn-text").textContent;
  upiBtn.dataset.defaultText = upiBtn.querySelector(".pay-btn-text").textContent;

  initAmount();
  bindEvents();
  log("Loaded", { amount: paymentAmount, backendConfigured: hasRequiredBackendConfig() });
})();
