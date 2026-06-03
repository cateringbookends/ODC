"use strict";

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const el = (id) => document.getElementById(id);
const inputs = {
  pax: el("pax"),
  days: el("days"),
  costPerPax: el("costPerPax"),
  foodCostPerPax: el("foodCostPerPax"),
  staffCount: el("staffCount"),
  totalStaffCostInput: el("totalStaffCostInput"),
  staffFoodCost: el("staffFoodCost"),
  staffTransportationCharge: el("staffTransportationCharge"),
  staffAccommodationCharge: el("staffAccommodationCharge"),
  refervanCharge: el("refervanCharge"),
  equipmentTransportationCharge: el("equipmentTransportationCharge"),
  equipmentDepreciation: el("equipmentDepreciation"),
  thirdPartyVendor: el("thirdPartyVendor"),
  decorCharge: el("decorCharge"),
  miscellaneousCost: el("miscellaneousCost"),
};

const outputs = {
  totalBilling: el("totalBilling"),
  billingBeforeGst: el("billingBeforeGst"),
  gstAmount: el("gstAmount"),
  foodTotal: el("foodTotal"),
  staffTotal: el("staffTotal"),
  outstationTotal: el("outstationTotal"),
  totalCost: el("totalCost"),
  profitLoss: el("profitLoss"),
};

let staffFoodTouched = false;
let decorTouched = false;
let staffCostTouched = false;

function readNumber(input) {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : 0;
}

function money(value) {
  return fmt.format(Number(value) || 0);
}

function recalc() {
  const pax = readNumber(inputs.pax);
  const days = Math.max(readNumber(inputs.days), 1);
  const costPerPax = readNumber(inputs.costPerPax);
  const foodCostPerPax = readNumber(inputs.foodCostPerPax);
  const staffCount = readNumber(inputs.staffCount);
  const staffCostPerDay = 1000;
  const gstRate = 0.05;
  const decorRate = 0.05;

  const billingBeforeGst = pax * days * costPerPax;
  const gstAmount = billingBeforeGst * gstRate;
  const totalBilling = billingBeforeGst + gstAmount;
  const foodTotal = pax * foodCostPerPax;
  if (!staffCostTouched && document.activeElement !== inputs.totalStaffCostInput) {
    inputs.totalStaffCostInput.value = String(staffCount * staffCostPerDay * days || 0);
  }
  const staffTotal = readNumber(inputs.totalStaffCostInput);

  if (!staffFoodTouched && document.activeElement !== inputs.staffFoodCost) {
    inputs.staffFoodCost.value = String(staffCount * 1000 || 0);
  }
  if (!decorTouched && document.activeElement !== inputs.decorCharge) {
    inputs.decorCharge.value = String(totalBilling * decorRate || 0);
  }

  const outstationTotal =
    readNumber(inputs.staffTransportationCharge) +
    readNumber(inputs.staffAccommodationCharge) +
    readNumber(inputs.staffFoodCost) +
    readNumber(inputs.refervanCharge) +
    readNumber(inputs.equipmentTransportationCharge);

  const totalCost =
    foodTotal +
    staffTotal +
    readNumber(inputs.equipmentDepreciation) +
    readNumber(inputs.thirdPartyVendor) +
    readNumber(inputs.decorCharge) +
    readNumber(inputs.miscellaneousCost) +
    outstationTotal;

  const profitLoss = totalBilling - totalCost;

  outputs.totalBilling.textContent = money(totalBilling);
  outputs.billingBeforeGst.textContent = money(billingBeforeGst);
  outputs.gstAmount.textContent = money(gstAmount);
  outputs.foodTotal.textContent = money(foodTotal);
  outputs.staffTotal.textContent = money(staffTotal);
  outputs.outstationTotal.textContent = money(outstationTotal);
  outputs.totalCost.textContent = money(totalCost);
  outputs.profitLoss.textContent = money(profitLoss);
  outputs.profitLoss.classList.toggle("loss-output", profitLoss < 0);
}

Object.values(inputs).forEach((input) => {
  input.addEventListener("input", () => {
    if (input === inputs.staffFoodCost) staffFoodTouched = true;
    if (input === inputs.decorCharge) decorTouched = true;
    if (input === inputs.totalStaffCostInput) staffCostTouched = true;
    recalc();
  });
});

document.querySelectorAll(".date-dmy").forEach((input) => {
  if (window.ODC?.attachDateMask) window.ODC.attachDateMask(input);
});

recalc();
