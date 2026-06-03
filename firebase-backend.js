"use strict";
/**
 * firebase-backend.js — replaces Node.js/SQLite server
 * All data operations go directly to Firestore from the browser.
 */
(function () {
  const db   = window.ODC_DB;
  const auth = window.ODC_AUTH;
  const GST  = 0.05;

  /* ---- helpers ---- */
  function ts() { return firebase.firestore.FieldValue.serverTimestamp(); }
  function nowIso() { return new Date().toISOString(); }

  /* ================================================================
   * EVENTS
   * ================================================================ */
  async function getAllEvents() {
    const snap = await db.collection("events").orderBy("date").get();
    return snap.docs.map(d => d.data());
  }

  async function getEventById(id) {
    const doc = await db.collection("events").doc(String(id)).get();
    return doc.exists ? doc.data() : null;
  }

  async function upsertEvent(e) {
    const id = String(e.id || ("EVT-" + Date.now()));
    const pax = Math.floor(Number(e.pax)) || 0;
    const days = Math.floor(Number(e.days)) > 0 ? Math.floor(Number(e.days)) : 1;
    const cpp  = Number(e.costPerPax) || 0;
    const base = pax * days * cpp;
    const data = {
      id, externalId: e.externalId || "",
      entryDate: e.entryDate || "", date: e.date,
      name: String(e.name || "").trim(), location: String(e.location || "").trim(),
      locationZone: e.locationZone || "", pax, days, costPerPax: cpp,
      totalBilling: base + base * GST,
      status: e.status || "open",
      time: e.time || "", foodType: e.foodType || "",
      allergicCount: Math.max(Number(e.allergicCount) || 0, 0),
      allergicNotes: e.allergicNotes || "",
      paymentSchedule: Array.isArray(e.paymentSchedule) ? e.paymentSchedule : [],
      invoiceKyc: e.invoiceKyc || {},
      updatedAt: nowIso()
    };
    const existing = await db.collection("events").doc(id).get();
    if (!existing.exists) data.createdAt = nowIso();
    await db.collection("events").doc(id).set(data, { merge: true });
    await auditLog("upsertEvent", "event", id);
    return data;
  }

  async function deleteEvent(id) {
    await db.collection("events").doc(String(id)).delete();
    await db.collection("pettyCash").doc(String(id)).delete().catch(() => {});
    await db.collection("preCost").doc(String(id)).delete().catch(() => {});
    await auditLog("deleteEvent", "event", id);
  }

  /* ================================================================
   * MASTER PERSONS  (stored as single doc /config/masterPersons)
   * ================================================================ */
  async function getMasterPersons() {
    const doc = await db.collection("config").doc("masterPersons").get();
    return doc.exists ? (doc.data().heads || []) : [];
  }

  async function saveMasterPersons(heads) {
    await db.collection("config").doc("masterPersons").set({ heads, updatedAt: nowIso() });
    await auditLog("saveMasterPersons", "masterPersons", null);
    return heads;
  }

  /* ================================================================
   * PETTY CASH
   * ================================================================ */
  async function getPettyCash(eventId) {
    const doc = await db.collection("pettyCash").doc(String(eventId)).get();
    return doc.exists ? doc.data() : { payouts: [], petty: [] };
  }

  async function savePettyCash(eventId, data) {
    await db.collection("pettyCash").doc(String(eventId)).set({
      payouts: data.payouts || [], petty: data.petty || [], updatedAt: nowIso()
    });
    await auditLog("savePettyCash", "pettyCash", eventId);
    return getPettyCash(eventId);
  }

  /* ================================================================
   * PRE-COST
   * ================================================================ */
  async function getPreCost(eventId) {
    const doc = await db.collection("preCost").doc(String(eventId)).get();
    const empty = { foodCostPerPax:0,staffCount:0,totalStaffCost:0,equipmentDepreciation:0,thirdPartyVendor:0,decorCharge:0,miscellaneousCost:0,staffTransportationCharge:0,staffAccommodationCharge:0,staffFoodCost:0,refervanCharge:0,equipmentTransportationCharge:0,totalCost:0,profitLoss:0 };
    return doc.exists ? Object.assign({}, empty, doc.data()) : empty;
  }

  async function savePreCost(eventId, data) {
    await db.collection("preCost").doc(String(eventId)).set(
      Object.assign({}, data, { updatedAt: nowIso() })
    );
    await auditLog("savePreCost", "preCost", eventId);
    return getPreCost(eventId);
  }

  /* ================================================================
   * BILLS
   * ================================================================ */
  async function getBills(adminMode) {
    let q = db.collection("bills").orderBy("submittedAt", "desc");
    if (!adminMode) {
      const uid = auth.currentUser ? auth.currentUser.uid : null;
      if (!uid) return [];
      q = q.where("submittedByUid", "==", uid);
    }
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function createBill(data) {
    const user = auth.currentUser;
    const ref = db.collection("bills").doc();
    const bill = {
      eventId: data.eventId, eventName: data.eventName || "",
      submittedByUid: user ? user.uid : "",
      submittedByUsername: user ? (user.displayName || user.email) : "",
      headId: data.headId, headName: data.headName || data.headId,
      personName: data.personName,
      amount: Number(data.amount), description: data.description || "",
      category: data.category || "misc", status: "pending",
      submittedAt: nowIso(), reviewedBy: "", reviewedAt: ""
    };
    await ref.set(bill);
    await auditLog("createBill", "bill", ref.id);
    return ref.id;
  }

  async function reviewBill(billId, status, reviewerName) {
    await db.collection("bills").doc(billId).update({
      status, reviewedBy: reviewerName, reviewedAt: nowIso()
    });
    await auditLog("reviewBill", "bill", billId, status);
  }

  /* ================================================================
   * USERS  (profile stored in /users/{uid})
   * ================================================================ */
  async function getUserProfile(uid) {
    const doc = await db.collection("users").doc(uid).get();
    return doc.exists ? doc.data() : null;
  }

  async function getAllUsers() {
    const snap = await db.collection("users").get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  }

  async function createUser(username, password, fullName, role) {
    const email = username.toLowerCase() + "@odc.local";
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await auth.currentUser.updateProfile({ displayName: username });
    await db.collection("users").doc(cred.user.uid).set({
      username: username.toLowerCase(), fullName: fullName || "", role: role || "user",
      email, createdAt: nowIso()
    });
    await auditLog("createUser", "user", username);
    return cred.user.uid;
  }

  async function deleteUser(uid) {
    await db.collection("users").doc(uid).delete();
    await auditLog("deleteUser", "user", uid);
  }

  /* ================================================================
   * AUTH
   * ================================================================ */
  async function login(username, password) {
    const email = username.toLowerCase() + "@odc.local";
    const cred  = await auth.signInWithEmailAndPassword(email, password);
    const profile = await getUserProfile(cred.user.uid);
    await auditLog("login", "auth", username);
    return { uid: cred.user.uid, username, role: profile ? profile.role : "user" };
  }

  async function logout() {
    const user = auth.currentUser;
    if (user) await auditLog("logout", "auth", user.displayName || user.email);
    await auth.signOut();
  }

  async function getCurrentUser() {
    const user = auth.currentUser;
    if (!user) return null;
    const profile = await getUserProfile(user.uid);
    return { uid: user.uid, username: profile ? profile.username : user.email, role: profile ? profile.role : "user" };
  }

  /* ================================================================
   * AUDIT LOG
   * ================================================================ */
  async function auditLog(action, entityType, entityId, detail) {
    const user = auth.currentUser;
    try {
      await db.collection("auditLog").add({
        username: user ? (user.displayName || user.email) : "system",
        uid: user ? user.uid : "",
        action, entityType,
        entityId: entityId != null ? String(entityId) : "",
        detail: detail != null ? String(detail) : "",
        ts: nowIso(), userAgent: navigator.userAgent.slice(0, 100)
      });
    } catch(e) { /* never let audit failure break the app */ }
  }

  /* ================================================================
   * Setup admin user on first run
   * ================================================================ */
  async function ensureAdminExists() {
    try {
      await auth.signInWithEmailAndPassword("aiops@odc.local", "AIops");
      return; // already exists
    } catch (e) {
      if (e.code !== "auth/user-not-found" && e.code !== "auth/invalid-credential" && e.code !== "auth/invalid-email") return;
    }
    try {
      const cred = await auth.createUserWithEmailAndPassword("aiops@odc.local", "AIops");
      await auth.currentUser.updateProfile({ displayName: "aiops" });
      await db.collection("users").doc(cred.user.uid).set({
        username: "aiops", fullName: "Admin", role: "admin",
        email: "aiops@odc.local", createdAt: nowIso()
      });
      await auth.signOut();
    } catch(e2) { /* already exists */ }
  }

  /* ================================================================
   * Export
   * ================================================================ */
  window.FB = {
    getAllEvents, getEventById, upsertEvent, deleteEvent,
    getMasterPersons, saveMasterPersons,
    getPettyCash, savePettyCash,
    getPreCost, savePreCost,
    getBills, createBill, reviewBill,
    getUserProfile, getAllUsers, createUser, deleteUser,
    login, logout, getCurrentUser,
    auditLog, ensureAdminExists
  };
}());
