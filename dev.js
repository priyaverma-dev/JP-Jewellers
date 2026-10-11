(function () {
    "use strict";

    const STORAGE_KEY = "aurelia.gold-loans.v1";
    const ENQUIRY_STORAGE_KEY = "aurelia.enquiries.v1";
    const today = localDateString(new Date());
    const enquiryStages = [
        { id: "new", label: "New" },
        { id: "contacted", label: "Contacted" },
        { id: "followup", label: "Follow-up" },
        { id: "converted", label: "Converted" }
    ];
    const state = { loans: [], enquiries: [], filter: "all", query: "" };
    let toastTimer;
    let payoffDateManuallySet = false;

    const elements = {
        todayLabel: document.getElementById("today-label"),
        form: document.getElementById("loan-form"),
        formPanel: document.getElementById("loan-form-panel"),
        formError: document.getElementById("form-error"),
        startDate: document.getElementById("start-date"),
        redemptionDate: document.getElementById("redemption-date"),
        retentionMonths: document.getElementById("retention-months"),
        maturityHint: document.getElementById("maturity-hint"),
        amount: document.getElementById("loan-amount"),
        rate: document.getElementById("interest-rate"),
        payoffTotal: document.getElementById("payoff-total"),
        payoffPrincipal: document.getElementById("payoff-principal"),
        payoffInterest: document.getElementById("payoff-interest"),
        payoffDays: document.getElementById("payoff-days"),
        payoffRate: document.getElementById("payoff-rate"),
        rows: document.getElementById("loan-rows"),
        emptyState: document.getElementById("empty-state"),
        emptyTitle: document.getElementById("empty-title"),
        emptyDescription: document.getElementById("empty-description"),
        recordCount: document.getElementById("record-count"),
        search: document.getElementById("search-input"),
        toast: document.getElementById("toast"),
        enquiryForm: document.getElementById("enquiry-form"),
        enquiryError: document.getElementById("enquiry-error"),
        enquiryBoard: document.getElementById("enquiry-board"),
        enquiryTotal: document.getElementById("enquiry-total")
    };

    function localDateString(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return year + "-" + month + "-" + day;
    }

    function parseLocalDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
        const parts = value.split("-").map(Number);
        const date = new Date(parts[0], parts[1] - 1, parts[2]);
        if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) return null;
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function formatDate(value) {
        const date = parseLocalDate(value);
        if (!date) return "—";
        return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
    }

    function formatMoney(amount) {
        return new Intl.NumberFormat("en-IN", {
            style: "currency",
            currency: "INR",
            maximumFractionDigits: 2
        }).format(Number.isFinite(amount) ? amount : 0);
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (character) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
        });
    }

    function calculate(principal, annualRate, startDate, endDate) {
        const start = parseLocalDate(startDate);
        const end = parseLocalDate(endDate);
        if (!start || !end) return { days: 0, interest: 0, total: principal };
        const days = Math.round((end.getTime() - start.getTime()) / 86400000);
        const interest = Math.round(principal * (annualRate / 100) * Math.max(days, 0) / 365 * 100) / 100;
        return { days: Math.max(days, 0), interest: interest, total: principal + interest };
    }

    function addMonths(dateValue, months) {
        const date = parseLocalDate(dateValue);
        const monthCount = Number(months);
        if (!date || !Number.isInteger(monthCount) || monthCount < 1 || monthCount > 240) return null;
        const day = date.getDate();
        date.setDate(1);
        date.setMonth(date.getMonth() + monthCount);
        const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        date.setDate(Math.min(day, lastDay));
        return localDateString(date);
    }

    function showToast(message, isError) {
        window.clearTimeout(toastTimer);
        elements.toast.textContent = message;
        elements.toast.classList.toggle("error", Boolean(isError));
        elements.toast.classList.add("visible");
        toastTimer = window.setTimeout(function () {
            elements.toast.classList.remove("visible");
        }, 3600);
    }

    function showFormError(message) {
        elements.formError.textContent = message;
        elements.formError.classList.add("visible");
    }

    function hideFormError() {
        elements.formError.textContent = "";
        elements.formError.classList.remove("visible");
    }

    function updateEstimate() {
        const principal = Number(elements.amount.value) || 0;
        const rate = Number(elements.rate.value) || 0;
        const maturityDate = addMonths(elements.startDate.value, Number(elements.retentionMonths.value));
        if (!payoffDateManuallySet && maturityDate) elements.redemptionDate.value = maturityDate;
        elements.redemptionDate.min = elements.startDate.value;
        const result = calculate(principal, rate, elements.startDate.value, elements.redemptionDate.value);
        elements.payoffTotal.textContent = formatMoney(result.total);
        elements.payoffPrincipal.textContent = formatMoney(principal);
        elements.payoffInterest.textContent = formatMoney(result.interest);
        elements.payoffDays.textContent = result.days + (result.days === 1 ? " day" : " days");
        elements.payoffRate.textContent = rate + "% p.a.";
        elements.maturityHint.textContent = maturityDate
            ? "Retention period ends " + formatDate(maturityDate) + "."
            : "Enter a valid start date and retention period.";
    }

    function saveLoans() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.loans));
            return true;
        } catch (error) {
            showToast("Could not save this change in browser storage. Check available storage and try again.", true);
            return false;
        }
    }

    function loadLoans() {
        try {
            const saved = window.localStorage.getItem(STORAGE_KEY);
            if (!saved) return;
            const loans = JSON.parse(saved);
            if (!Array.isArray(loans) || loans.some(function (loan) {
                return !loan || typeof loan.id !== "string" || typeof loan.name !== "string" ||
                    typeof loan.phone !== "string" || !Number.isFinite(Number(loan.amount)) ||
                    !Number.isFinite(Number(loan.weight)) || !Number.isFinite(Number(loan.rate)) ||
                    !parseLocalDate(loan.startDate) || !Number.isInteger(Number(loan.retentionMonths)) ||
                    !["active", "redeemed"].includes(loan.status) ||
                    (loan.status === "redeemed" && !parseLocalDate(loan.redemptionDate));
            })) {
                throw new Error("Saved loan data is invalid.");
            }
            state.loans = loans;
        } catch (error) {
            showToast("Saved records could not be read. Your existing browser data was left untouched.", true);
        }
    }

    function saveEnquiries() {
        try {
            window.localStorage.setItem(ENQUIRY_STORAGE_KEY, JSON.stringify(state.enquiries));
            return true;
        } catch (error) {
            showToast("Could not save this enquiry in browser storage. Check available storage and try again.", true);
            return false;
        }
    }

    function loadEnquiries() {
        try {
            const saved = window.localStorage.getItem(ENQUIRY_STORAGE_KEY);
            if (!saved) return;
            const enquiries = JSON.parse(saved);
            if (!Array.isArray(enquiries) || enquiries.some(function (enquiry) {
                return !enquiry || typeof enquiry.id !== "string" ||
                    typeof enquiry.name !== "string" || typeof enquiry.phone !== "string" ||
                    !Number.isFinite(Number(enquiry.amount)) || typeof enquiry.note !== "string" ||
                    !["", null].includes(enquiry.followUp) && !parseLocalDate(enquiry.followUp) ||
                    !enquiryStages.some(function (stage) { return stage.id === enquiry.stage; }) ||
                    typeof enquiry.createdAt !== "string";
            })) {
                throw new Error("Saved enquiry data is invalid.");
            }
            state.enquiries = enquiries;
        } catch (error) {
            showToast("Saved enquiries could not be read. Your existing browser data was left untouched.", true);
        }
    }

    function saveEnquiry(event) {
        event.preventDefault();
        elements.enquiryError.textContent = "";
        elements.enquiryError.classList.remove("visible");
        if (!elements.enquiryForm.reportValidity()) return;

        const formData = new FormData(elements.enquiryForm);
        const name = String(formData.get("name")).trim().replace(/\s+/g, " ");
        const phone = String(formData.get("phone")).trim();
        const digits = phone.replace(/\D/g, "");
        const amountInput = String(formData.get("amount")).trim();
        const amount = amountInput ? Number(amountInput) : 0;
        const followUp = String(formData.get("followUp")).trim();
        const note = String(formData.get("note")).trim();
        if (name.length < 2) return showEnquiryError("Please enter the customer's name.");
        if (digits.length < 7) return showEnquiryError("Please enter a valid phone number with at least 7 digits.");
        if (!Number.isFinite(amount) || amount < 0) return showEnquiryError("Expected amount must be zero or greater.");
        if (followUp && !parseLocalDate(followUp)) return showEnquiryError("Please enter a valid follow-up date.");

        const enquiry = {
            id: "ENQ-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase(),
            name: name,
            phone: phone,
            amount: Math.round(amount * 100) / 100,
            followUp: followUp,
            note: note,
            stage: "new",
            createdAt: new Date().toISOString()
        };
        state.enquiries.push(enquiry);
        if (!saveEnquiries()) {
            state.enquiries.pop();
            return;
        }
        elements.enquiryForm.reset();
        renderEnquiries();
        showToast("Enquiry for " + enquiry.name + " added to the board.");
    }

    function showEnquiryError(message) {
        elements.enquiryError.textContent = message;
        elements.enquiryError.classList.add("visible");
    }

    function renderEnquiries() {
        elements.enquiryTotal.textContent = state.enquiries.length + (state.enquiries.length === 1 ? " enquiry" : " enquiries");
        elements.enquiryBoard.innerHTML = enquiryStages.map(function (stage) {
            const enquiries = state.enquiries.filter(function (enquiry) {
                return enquiry.stage === stage.id;
            }).slice().sort(function (a, b) {
                return b.createdAt.localeCompare(a.createdAt);
            });
            const cards = enquiries.length ? enquiries.map(function (enquiry) {
                const options = enquiryStages.map(function (option) {
                    return '<option value="' + option.id + '"' + (enquiry.stage === option.id ? " selected" : "") + ">" + option.label + "</option>";
                }).join("");
                const expectedAmount = Number(enquiry.amount) > 0
                    ? '<p class="enquiry-amount">Expected loan · ' + escapeHtml(formatMoney(Number(enquiry.amount))) + "</p>"
                    : "";
                const note = enquiry.note
                    ? '<p class="enquiry-note">' + escapeHtml(enquiry.note) + "</p>"
                    : "";
                const followUp = enquiry.followUp
                    ? '<p class="enquiry-followup"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Follow up · ' + escapeHtml(formatDate(enquiry.followUp)) + "</p>"
                    : "";
                return '<article class="enquiry-card" data-enquiry-id="' + escapeHtml(enquiry.id) + '">' +
                    '<div class="enquiry-card-top"><div><div class="enquiry-customer">' + escapeHtml(enquiry.name) + '</div><div class="enquiry-phone">' + escapeHtml(enquiry.phone) + "</div></div></div>" +
                    expectedAmount + note + followUp +
                    '<div class="enquiry-card-actions"><label><span class="sr-only">Update stage for ' + escapeHtml(enquiry.name) + '</span><select class="enquiry-stage" data-action="stage" data-id="' + escapeHtml(enquiry.id) + '">' + options + "</select></label>" +
                    '<button class="enquiry-delete" type="button" data-action="delete-enquiry" data-id="' + escapeHtml(enquiry.id) + '" aria-label="Remove enquiry for ' + escapeHtml(enquiry.name) + '"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 7h15M9 7V4.5h6V7m-8.5 0 .8 13h9.4l.8-13M10 10.5v6m4-6v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>' +
                    "</article>";
            }).join("") : '<p class="lane-empty">No enquiries here yet</p>';
            return '<section class="enquiry-lane" aria-label="' + stage.label + ' enquiries"><div class="lane-heading"><span>' + stage.label + '</span><span class="lane-count">' + enquiries.length + "</span></div><div class=\"enquiry-list\">" + cards + "</div></section>";
        }).join("");
    }

    function updateEnquiryStage(id, stageId) {
        const enquiry = state.enquiries.find(function (record) { return record.id === id; });
        const stageIsValid = enquiryStages.some(function (stage) { return stage.id === stageId; });
        if (!enquiry || !stageIsValid) return;
        const previousStage = enquiry.stage;
        enquiry.stage = stageId;
        if (!saveEnquiries()) {
            enquiry.stage = previousStage;
        }
        renderEnquiries();
    }

    function deleteEnquiry(id) {
        const index = state.enquiries.findIndex(function (record) { return record.id === id; });
        if (index < 0) return;
        const removed = state.enquiries.splice(index, 1)[0];
        if (!saveEnquiries()) {
            state.enquiries.splice(index, 0, removed);
            return;
        }
        renderEnquiries();
        showToast("Enquiry for " + removed.name + " removed.");
    }

    function makeLoanId() {
        let id;
        do {
            id = "GL-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 5).toUpperCase();
        } while (state.loans.some(function (loan) { return loan.id === id; }));
        return id;
    }

    function setFilter(filter) {
        state.filter = filter;
        document.querySelectorAll(".filter-tab").forEach(function (button) {
            const selected = button.dataset.filter === filter;
            button.classList.toggle("active", selected);
            button.setAttribute("aria-selected", String(selected));
        });
        renderLoans();
    }

    function renderStats() {
        const active = state.loans.filter(function (loan) { return loan.status === "active"; });
        const redeemed = state.loans.filter(function (loan) { return loan.status === "redeemed"; });
        const totalLent = active.reduce(function (sum, loan) { return sum + Number(loan.amount); }, 0);
        const totalGold = active.reduce(function (sum, loan) { return sum + Number(loan.weight); }, 0);
        document.getElementById("stat-active").textContent = String(active.length);
        document.getElementById("stat-lent").textContent = formatMoney(totalLent);
        document.getElementById("stat-gold").textContent = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(totalGold) + " g";
        document.getElementById("stat-redeemed").textContent = String(redeemed.length);
    }

    function renderLoans() {
        const query = state.query.trim().toLocaleLowerCase();
        const matchingLoans = state.loans.filter(function (loan) {
            const matchesFilter = state.filter === "all" || loan.status === state.filter;
            const matchesQuery = !query || [loan.name, loan.phone, loan.id].some(function (value) {
                return String(value).toLocaleLowerCase().includes(query);
            });
            return matchesFilter && matchesQuery;
        }).slice().sort(function (a, b) {
            return b.createdAt.localeCompare(a.createdAt);
        });

        elements.rows.innerHTML = matchingLoans.map(function (loan) {
            const statusLabel = loan.status === "active" ? "Active" : "Redeemed";
            const payoffDate = loan.status === "redeemed" ? loan.redemptionDate : today;
            const payoff = calculate(Number(loan.amount), Number(loan.rate), loan.startDate, payoffDate);
            const initials = loan.name.trim().split(/\s+/).slice(0, 2).map(function (part) { return part.charAt(0); }).join("");
            const action = loan.status === "active"
                ? '<button class="action-button" type="button" data-action="redeem" data-id="' + escapeHtml(loan.id) + '" aria-label="Mark ' + escapeHtml(loan.name) + '\'s loan as redeemed"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 9.5 17 19 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Redeem</button>'
                : '<span style="color:#99978e;font-size:9px">' + escapeHtml(formatDate(loan.redemptionDate)) + '</span>';
            return '<tr>' +
                '<td><div class="customer-cell"><span class="customer-avatar">' + escapeHtml(initials) + '</span><span><span class="customer-name">' + escapeHtml(loan.name) + '</span><span class="customer-phone">' + escapeHtml(loan.phone) + '</span></span></div></td>' +
                '<td class="loan-id" data-label="Loan ID">' + escapeHtml(loan.id) + '</td>' +
                '<td class="table-amount" data-label="Loan amount">' + escapeHtml(formatMoney(Number(loan.amount))) + '</td>' +
                '<td class="weight-cell" data-label="Gold pledged">' + escapeHtml(Number(loan.weight).toLocaleString("en-IN", { maximumFractionDigits: 2 })) + ' g</td>' +
                '<td class="table-amount" data-label="Payoff amount">' + escapeHtml(formatMoney(payoff.total)) + '</td>' +
                '<td data-label="Status"><span class="status-pill status-' + loan.status + '">' + statusLabel + '</span></td>' +
                '<td><div class="row-actions">' + action + '</div></td>' +
                '</tr>';
        }).join("");

        elements.emptyState.hidden = matchingLoans.length > 0;
        elements.recordCount.textContent = matchingLoans.length + (matchingLoans.length === 1 ? " record" : " records");
        if (!matchingLoans.length) {
            const isEmptyLedger = state.loans.length === 0;
            elements.emptyTitle.textContent = isEmptyLedger ? "Your ledger starts here" : "No loans found";
            elements.emptyDescription.textContent = isEmptyLedger
                ? "Add your first gold loan and its details will be ready whenever you need them."
                : state.query.trim()
                    ? "No records match that search. Try another name, phone number, or loan ID."
                    : "There are no " + (state.filter === "all" ? "" : state.filter + " ") + "loans in this view.";
        }
        renderStats();
    }

    function handleSubmit(event) {
        event.preventDefault();
        hideFormError();
        if (!elements.form.reportValidity()) return;

        const formData = new FormData(elements.form);
        const name = String(formData.get("name")).trim().replace(/\s+/g, " ");
        const phone = String(formData.get("phone")).trim();
        const phoneDigits = phone.replace(/\D/g, "");
        const amount = Number(formData.get("amount"));
        const weight = Number(formData.get("weight"));
        const rate = Number(formData.get("interestRate"));
        const retentionMonths = Number(formData.get("retentionMonths"));
        const startDate = String(formData.get("startDate"));
        const redemptionDate = String(formData.get("redemptionDate"));
        if (name.length < 2) return showFormError("Please enter the customer's full name.");
        if (phoneDigits.length < 7) return showFormError("Please enter a valid phone number with at least 7 digits.");
        if (!Number.isFinite(amount) || amount <= 0) return showFormError("Loan amount must be greater than zero.");
        if (!Number.isFinite(weight) || weight <= 0) return showFormError("Gold weight must be greater than zero.");
        if (!Number.isFinite(rate) || rate < 0 || rate > 1000) return showFormError("Enter an annual interest rate between 0 and 1,000%.");
        if (!Number.isInteger(retentionMonths) || retentionMonths < 1 || retentionMonths > 240) return showFormError("Retention period must be between 1 and 240 whole months.");
        if (!parseLocalDate(startDate) || !parseLocalDate(redemptionDate)) return showFormError("Please enter valid start and payoff dates.");
        if (redemptionDate < startDate) return showFormError("The payoff date cannot be before the start date.");

        const loan = {
            id: makeLoanId(),
            name: name,
            phone: phone,
            amount: Math.round(amount * 100) / 100,
            weight: Math.round(weight * 100) / 100,
            rate: Math.round(rate * 100) / 100,
            startDate: startDate,
            retentionMonths: retentionMonths,
            status: "active",
            createdAt: new Date().toISOString()
        };
        state.loans.push(loan);
        if (!saveLoans()) {
            state.loans.pop();
            return;
        }

        elements.form.reset();
        elements.startDate.value = today;
        elements.retentionMonths.value = "6";
        elements.rate.value = "12";
        payoffDateManuallySet = false;
        updateEstimate();
        setFilter("all");
        showToast("Loan " + loan.id + " saved. Records stay in this browser only.");
    }

    function redeemLoan(id) {
        const loan = state.loans.find(function (record) { return record.id === id; });
        if (!loan || loan.status !== "active") return;
        const quote = calculate(Number(loan.amount), Number(loan.rate), loan.startDate, today);
        const confirmed = window.confirm(
            "Mark this loan as redeemed today?\n\nCustomer: " + loan.name +
            "\nPrincipal: " + formatMoney(Number(loan.amount)) +
            "\nInterest to " + formatDate(today) + ": " + formatMoney(quote.interest) +
            "\nEstimated amount due: " + formatMoney(quote.total) +
            "\n\nThis records the estimate only. Confirm the final payment separately."
        );
        if (!confirmed) return;
        loan.status = "redeemed";
        loan.redemptionDate = today;
        loan.finalInterest = quote.interest;
        loan.finalAmount = quote.total;
        if (!saveLoans()) {
            delete loan.status;
            delete loan.redemptionDate;
            delete loan.finalInterest;
            delete loan.finalAmount;
            return;
        }
        renderLoans();
        showToast("Loan " + loan.id + " marked as redeemed. Please verify the payment separately.");
    }

    elements.todayLabel.textContent = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(new Date());
    elements.startDate.value = today;
    elements.redemptionDate.value = addMonths(today, Number(elements.retentionMonths.value));
    loadLoans();
    loadEnquiries();
    updateEstimate();
    renderLoans();
    renderEnquiries();

    ["input", "change"].forEach(function (eventName) {
        [elements.amount, elements.rate, elements.startDate, elements.retentionMonths].forEach(function (input) {
            input.addEventListener(eventName, updateEstimate);
        });
    });
    ["input", "change"].forEach(function (eventName) {
        elements.redemptionDate.addEventListener(eventName, function () {
            payoffDateManuallySet = true;
            updateEstimate();
        });
    });
    elements.form.addEventListener("input", hideFormError);
    elements.form.addEventListener("submit", handleSubmit);
    elements.enquiryForm.addEventListener("input", function () {
        elements.enquiryError.textContent = "";
        elements.enquiryError.classList.remove("visible");
    });
    elements.enquiryForm.addEventListener("submit", saveEnquiry);
    elements.enquiryBoard.addEventListener("change", function (event) {
        const select = event.target.closest("[data-action='stage']");
        if (select) updateEnquiryStage(select.dataset.id, select.value);
    });
    elements.enquiryBoard.addEventListener("click", function (event) {
        const button = event.target.closest("[data-action='delete-enquiry']");
        if (button) deleteEnquiry(button.dataset.id);
    });
    elements.search.addEventListener("input", function () {
        state.query = elements.search.value;
        renderLoans();
    });
    document.querySelectorAll(".filter-tab").forEach(function (button) {
        button.addEventListener("click", function () { setFilter(button.dataset.filter); });
    });
    elements.rows.addEventListener("click", function (event) {
        const button = event.target.closest("[data-action='redeem']");
        if (button) redeemLoan(button.dataset.id);
    });
    document.getElementById("new-loan-button").addEventListener("click", function () {
        elements.formPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        document.getElementById("customer-name").focus({ preventScroll: true });
    });
})();