import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  connectAuthEmulator 
} from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  onSnapshot, 
  serverTimestamp,
  connectFirestoreEmulator,
  Timestamp
} from "firebase/firestore";

// ===============================================================
// Global State & Config
// ===============================================================

const DEFAULT_KICKOFF_MS = 1783713600000; // July 10, 2026 at 20:00 UTC

let currentUser = null;
let gameConfig = null;
let publicVoters = [];
let privatePredictions = {};
let currentPhase = ""; // "pre" | "locked" | "reveal"

// User's own current draft prediction
let userPrediction = null; // "Spain" | "Belgium"
let userHasVoted = false;

// Listeners active state
let unsubConfig = null;
let unsubPublicVoters = null;
let unsubPrivatePredictions = null;
let countdownInterval = null;

// Hybrid Mode Selection
let isMockMode = true; // Default to mock, check for emulator on init

// ===============================================================
// DOM Elements
// ===============================================================

const viewAuth = document.getElementById("view-auth");
const viewDashboard = document.getElementById("view-dashboard");
const appHeader = document.getElementById("app-header");
const sandboxBadge = document.getElementById("sandbox-badge");
const mockLoginSection = document.getElementById("mock-login-section");

const btnGoogleLogin = document.getElementById("btn-google-login");
const btnMockLogin = document.getElementById("btn-mock-login");
const mockUsernameInput = document.getElementById("mock-username-input");

const btnSignout = document.getElementById("btn-signout");
const userAvatar = document.getElementById("user-avatar");

const matchStatus = document.getElementById("match-status");
const statusText = document.getElementById("status-text");
const countdownLabel = document.getElementById("countdown-label");
const countdownTimer = document.getElementById("countdown-timer");

// Outcome selection buttons
let btnOutcomes = [];

const btnSubmitPrediction = document.getElementById("btn-submit-prediction");
const votersListContainer = document.getElementById("voters-list-container");
const voterCountBadge = document.getElementById("voter-count-badge");

const simulatorHeader = document.getElementById("simulator-header");
const simulatorBody = document.getElementById("simulator-body");
const simulatorToggleBtn = document.getElementById("simulator-toggle-btn");

const btnSimPre = document.getElementById("btn-sim-pre");
const btnSimPost = document.getElementById("btn-sim-post");
const btnSimReveal = document.getElementById("btn-sim-reveal");
const btnSimReset = document.getElementById("btn-sim-reset");
const btnSimAddVoters = document.getElementById("btn-sim-add-voters");

const toast = document.getElementById("toast");
const toastMessage = document.getElementById("toast-message");

// ===============================================================
// App Initialization
// ===============================================================

// Check if Firebase Emulator is running
async function detectDatabaseMode() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    try {
      // Try to fetch firestore emulator index
      const res = await fetch("http://localhost:8080/", { mode: "no-cors" });
      isMockMode = false;
      console.log("Firebase Emulator detected! Using Firebase Mode.");
    } catch (e) {
      isMockMode = true;
      console.log("Firebase Emulator NOT running. Falling back to client-side Mock Mode.");
    }
  } else {
    isMockMode = true;
  }
  
  initApplication();
}

detectDatabaseMode();

// ===============================================================
// Main Application Routing & Handlers
// ===============================================================

let firebaseApp, auth, db;

function initApplication() {
  if (!isMockMode) {
    // 1. Initialize Real Firebase SDK
    const firebaseConfig = {
      apiKey: "dummy-api-key-for-emulator-testing",
      authDomain: "fifa-prediction-app.firebaseapp.com",
      projectId: "fifa-prediction-app",
      storageBucket: "fifa-prediction-app.appspot.com",
      messagingSenderId: "1234567890",
      appId: "1:1234567890:web:abcdef"
    };

    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);

    connectAuthEmulator(auth, "http://localhost:9099");
    connectFirestoreEmulator(db, "localhost", 8080);
    
    // Auth observer for Firebase Auth
    onAuthStateChanged(auth, (user) => {
      handleAuthStateChange(user);
    });

    btnGoogleLogin.addEventListener("click", loginWithFirebaseGoogle);
  } else {
    // 2. Initialize Mock Mode
    console.log("Sandbox initialized.");
    sandboxBadge.classList.remove("hidden-element");
    mockLoginSection.classList.remove("hidden-element");
    
    // Check if there is an active mock user session in localStorage
    const savedUser = localStorage.getItem("mock_user");
    if (savedUser) {
      currentUser = JSON.parse(savedUser);
      handleAuthStateChange(currentUser);
    }

    btnGoogleLogin.addEventListener("click", () => {
      // Emulate Google login by prompting or focusing mock input
      mockUsernameInput.focus();
      showToast("Running offline. Type display name below to sign in!");
    });

    btnMockLogin.addEventListener("click", loginWithMockUser);
  }

  btnSignout.addEventListener("click", handleLogout);
  
  // Controls Setup
  btnOutcomes = Array.from(document.querySelectorAll(".btn-outcome"));
  btnOutcomes.forEach(btn => {
    btn.addEventListener("click", () => handleOutcomeSelect(btn));
  });
  btnSubmitPrediction.addEventListener("click", handlePredictionSubmit);

  // Simulator Setup
  simulatorHeader.addEventListener("click", toggleSimulatorCollapse);
  btnSimPre.addEventListener("click", () => setMockKickoffOffset(2 * 60 * 1000)); // +2m
  btnSimPost.addEventListener("click", () => setMockKickoffOffset(-2 * 60 * 1000)); // -2m
  btnSimReveal.addEventListener("click", () => setMockKickoffOffset(-6 * 60 * 1000)); // -6m
  btnSimReset.addEventListener("click", () => setMockKickoffOffset(0, true)); // Default date
  btnSimAddVoters.addEventListener("click", generateMockVoters);
}

// ===============================================================
// Auth Listeners & Auth Actions
// ===============================================================

function handleAuthStateChange(user) {
  if (user) {
    currentUser = user;
    userAvatar.src = user.photoURL || "https://api.dicebear.com/7.x/bottts/svg?seed=" + user.uid;
    
    viewAuth.classList.add("hidden-element");
    viewDashboard.classList.remove("hidden-element");
    appHeader.classList.remove("hidden-element");
    
    showToast(`Logged in as ${user.displayName}`);
    
    // Init state listeners
    if (!isMockMode) {
      initFirebaseListeners();
    } else {
      initMockListeners();
    }
  } else {
    currentUser = null;
    viewAuth.classList.remove("hidden-element");
    viewDashboard.classList.add("hidden-element");
    appHeader.classList.add("hidden-element");
    
    cleanupActiveListeners();
  }
}

async function loginWithFirebaseGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Firebase Login failed:", error);
    showToast("Google login failed.");
  }
}

function loginWithMockUser() {
  const name = mockUsernameInput.value.trim();
  if (!name) {
    showToast("Please enter a display name!");
    return;
  }

  // Generate a mock user object
  const mockUser = {
    uid: "mock_" + name.replace(/\s+/g, "_").toLowerCase() + "_" + Math.floor(Math.random() * 1000),
    displayName: name,
    photoURL: "https://api.dicebear.com/7.x/adventurer/svg?seed=" + encodeURIComponent(name)
  };

  localStorage.setItem("mock_user", JSON.stringify(mockUser));
  handleAuthStateChange(mockUser);
  mockUsernameInput.value = "";
}

async function handleLogout() {
  if (!isMockMode) {
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    }
  } else {
    localStorage.removeItem("mock_user");
    handleAuthStateChange(null);
  }
}

// ===============================================================
// Real-time Listeners (Firebase Mode)
// ===============================================================

function initFirebaseListeners() {
  cleanupActiveListeners();

  // 1. Config
  const configRef = doc(db, "config", "game");
  unsubConfig = onSnapshot(configRef, async (docSnap) => {
    if (docSnap.exists()) {
      gameConfig = docSnap.data();
    } else {
      const defaultKickoff = Timestamp.fromMillis(DEFAULT_KICKOFF_MS);
      await setDoc(configRef, {
        kickoffTime: defaultKickoff,
        teamA: "Spain",
        teamB: "Belgium"
      });
      gameConfig = { kickoffTime: defaultKickoff, teamA: "Spain", teamB: "Belgium" };
    }
    updateSimulationActiveBtn();
    startCountdown();
    loadFirebaseOwnPrediction();
  });

  // 2. Public Voters
  const publicCol = collection(db, "predictions_public");
  unsubPublicVoters = onSnapshot(publicCol, (querySnap) => {
    publicVoters = [];
    querySnap.forEach((doc) => {
      publicVoters.push(doc.data());
    });
    publicVoters.sort((a, b) => (b.votedAt?.toMillis() || 0) - (a.votedAt?.toMillis() || 0));
    renderVotersList();
  });
}

async function loadFirebaseOwnPrediction() {
  if (!currentUser) return;
  const privateDocRef = doc(db, "predictions_private", currentUser.uid);
  try {
    const docSnap = await getDoc(privateDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      userPrediction = data.prediction;
      userHasVoted = true;
      
      if (currentPhase === "pre") {
        // Highlight active button
        btnOutcomes.forEach(btn => {
          if (btn.getAttribute("data-outcome") === userPrediction) {
            btn.classList.add("selected");
          } else {
            btn.classList.remove("selected");
          }
        });
        btnSubmitPrediction.disabled = false;
        btnSubmitPrediction.innerText = "Update Prediction";
      }
    } else {
      userHasVoted = false;
      if (currentPhase === "pre") {
        btnOutcomes.forEach(btn => btn.classList.remove("selected"));
        btnSubmitPrediction.disabled = true;
        btnSubmitPrediction.innerText = "Select an Outcome";
      }
    }
  } catch (error) {
    console.error("Load own prediction error:", error);
  }
}

function startFirebasePrivatePredictions() {
  if (unsubPrivatePredictions) return;

  const privateCol = collection(db, "predictions_private");
  unsubPrivatePredictions = onSnapshot(privateCol, (querySnap) => {
    privatePredictions = {};
    querySnap.forEach((doc) => {
      privatePredictions[doc.id] = doc.data();
    });
    renderVotersList();
  }, (error) => {
    console.warn("Private data query rejected (expected if before reveal time):", error);
  });
}

// ===============================================================
// Mock Database Listeners (Mock Mode)
// ===============================================================

// Simple event-driven updates for mock mode
const mockEvents = {
  listeners: {},
  subscribe(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  },
  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }
};

function initMockListeners() {
  cleanupActiveListeners();

  // Load configuration from localstorage
  const loadMockConfig = () => {
    const stored = localStorage.getItem("mock_config");
    if (stored) {
      const parsed = JSON.parse(stored);
      gameConfig = {
        kickoffTime: { toMillis: () => parsed.kickoffTimeMs },
        teamA: parsed.teamA,
        teamB: parsed.teamB
      };
    } else {
      gameConfig = {
        kickoffTime: { toMillis: () => DEFAULT_KICKOFF_MS },
        teamA: "Spain",
        teamB: "Belgium"
      };
      localStorage.setItem("mock_config", JSON.stringify({ kickoffTimeMs: DEFAULT_KICKOFF_MS, teamA: "Spain", teamB: "Belgium" }));
    }
  };

  loadMockConfig();
  
  // Subscribe to config changes
  unsubConfig = mockEvents.subscribe("config_changed", () => {
    loadMockConfig();
    updateSimulationActiveBtn();
    startCountdown();
  });

  // Load public voters
  const loadMockVoters = () => {
    const stored = localStorage.getItem("mock_voters_public");
    publicVoters = stored ? JSON.parse(stored) : [];
    // Map dates back to millisecond equivalents for sorting
    publicVoters.sort((a, b) => b.votedAtMs - a.votedAtMs);
    renderVotersList();
  };

  loadMockVoters();
  unsubPublicVoters = mockEvents.subscribe("voters_changed", () => {
    loadMockVoters();
  });

  // Load private predictions
  const loadMockPrivate = () => {
    const stored = localStorage.getItem("mock_voters_private");
    privatePredictions = stored ? JSON.parse(stored) : {};
    renderVotersList();
  };

  loadMockPrivate();
  unsubPrivatePredictions = mockEvents.subscribe("private_changed", () => {
    loadMockPrivate();
  });

  // Load current user's mock prediction
  const loadMockOwnPrediction = () => {
    if (!currentUser) return;
    const stored = localStorage.getItem("mock_voters_private");
    const privateStore = stored ? JSON.parse(stored) : {};
    const myPred = privateStore[currentUser.uid];
    
    if (myPred) {
      userPrediction = myPred.prediction;
      userHasVoted = true;
      if (currentPhase === "pre") {
        btnOutcomes.forEach(btn => {
          if (btn.getAttribute("data-outcome") === userPrediction) {
            btn.classList.add("selected");
          } else {
            btn.classList.remove("selected");
          }
        });
        btnSubmitPrediction.disabled = false;
        btnSubmitPrediction.innerText = "Update Prediction";
      }
    } else {
      userHasVoted = false;
      if (currentPhase === "pre") {
        btnOutcomes.forEach(btn => btn.classList.remove("selected"));
        btnSubmitPrediction.disabled = true;
        btnSubmitPrediction.innerText = "Select an Outcome";
      }
    }
  };

  loadMockOwnPrediction();

  // Watch for state triggers
  updateSimulationActiveBtn();
  startCountdown();
}

function cleanupActiveListeners() {
  if (unsubConfig) unsubConfig();
  if (unsubPublicVoters) unsubPublicVoters();
  if (unsubPrivatePredictions) unsubPrivatePredictions();
  if (countdownInterval) clearInterval(countdownInterval);
  
  unsubConfig = null;
  unsubPublicVoters = null;
  unsubPrivatePredictions = null;
  countdownInterval = null;
}

// ===============================================================
// Prediction Selection Handler
// ===============================================================

function handleOutcomeSelect(btn) {
  if (currentPhase !== "pre") return;
  
  userPrediction = btn.getAttribute("data-outcome");
  
  btnOutcomes.forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  
  btnSubmitPrediction.disabled = false;
  btnSubmitPrediction.innerText = userHasVoted ? "Update Prediction" : "Submit Prediction";
}

// ===============================================================
// Prediction Submissions
// ===============================================================

async function handlePredictionSubmit() {
  if (!currentUser || !gameConfig || !userPrediction) return;
  
  if (currentPhase !== "pre") {
    showToast("Predictions are locked!");
    return;
  }

  btnSubmitPrediction.disabled = true;

  if (!isMockMode) {
    // 1. Submit Firebase
    try {
      const uid = currentUser.uid;
      const publicDoc = doc(db, "predictions_public", uid);
      await setDoc(publicDoc, {
        userId: uid,
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL || "",
        votedAt: serverTimestamp()
      });

      const privateDoc = doc(db, "predictions_private", uid);
      await setDoc(privateDoc, {
        userId: uid,
        prediction: userPrediction,
        votedAt: serverTimestamp()
      });

      userHasVoted = true;
      btnSubmitPrediction.innerText = "Update Prediction";
      showToast("Prediction saved successfully! 🏆");
    } catch (error) {
      console.error(error);
      showToast("Error locking in prediction.");
    } finally {
      btnSubmitPrediction.disabled = false;
    }
  } else {
    // 2. Submit Mock
    const uid = currentUser.uid;
    const nowMs = Date.now();

    // Save public list
    const storedPublic = localStorage.getItem("mock_voters_public");
    let publicList = storedPublic ? JSON.parse(storedPublic) : [];
    
    // Remove if already exists (updating)
    publicList = publicList.filter(item => item.userId !== uid);
    publicList.push({
      userId: uid,
      displayName: currentUser.displayName,
      photoURL: currentUser.photoURL || "",
      votedAtMs: nowMs
    });
    localStorage.setItem("mock_voters_public", JSON.stringify(publicList));

    // Save private scores
    const storedPrivate = localStorage.getItem("mock_voters_private");
    let privateMap = storedPrivate ? JSON.parse(storedPrivate) : {};
    privateMap[uid] = {
      userId: uid,
      prediction: userPrediction,
      votedAtMs: nowMs
    };
    localStorage.setItem("mock_voters_private", JSON.stringify(privateMap));

    userHasVoted = true;
    btnSubmitPrediction.innerText = "Update Prediction";
    btnSubmitPrediction.disabled = false;
    
    // Trigger mock subscriptions
    mockEvents.emit("voters_changed");
    mockEvents.emit("private_changed");
    
    showToast("Local prediction saved! 🏆");
  }
}

// ===============================================================
// Clock, Phases, and Countdown Engine
// ===============================================================

function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  updateClockAndPhase();
  countdownInterval = setInterval(updateClockAndPhase, 1000);
}

function updateClockAndPhase() {
  if (!gameConfig) return;

  const now = Date.now();
  const kickoffMs = gameConfig.kickoffTime.toMillis();
  const revealMs = kickoffMs + 5 * 60 * 1000; // 5 minutes post-kickoff

  if (now < kickoffMs) {
    setAppPhase("pre");
    
    const diff = kickoffMs - now;
    countdownTimer.innerText = formatTimeDiff(diff);
    countdownTimer.classList.remove("imminent", "expired");
    
    if (diff < 10 * 60 * 1000) {
      countdownTimer.classList.add("imminent"); // 10 min warning
    }
  } else if (now >= kickoffMs && now < revealMs) {
    setAppPhase("locked");
    
    const diff = revealMs - now;
    countdownTimer.innerText = formatTimeDiff(diff);
    countdownTimer.classList.remove("imminent");
    countdownTimer.classList.add("expired");
  } else {
    setAppPhase("reveal");
    countdownTimer.innerText = "Predictions Revealed!";
    countdownTimer.classList.remove("imminent", "expired");
  }
}

function setAppPhase(phase) {
  if (currentPhase === phase) return;
  currentPhase = phase;
  
  console.log(`Setting Phase: ${phase}`);
  
  if (phase === "pre") {
    matchStatus.className = "status-badge open";
    statusText.innerText = "Open";
    countdownLabel.innerText = "Time Remaining to Kickoff";
    
    btnOutcomes.forEach(btn => btn.disabled = false);
    btnSubmitPrediction.disabled = !userPrediction;
    btnSubmitPrediction.innerText = userHasVoted ? "Update Prediction" : "Submit Prediction";
    
  } else if (phase === "locked") {
    matchStatus.className = "status-badge locked";
    statusText.innerText = "Locked";
    countdownLabel.innerText = "Predictions Reveal In";
    
    btnOutcomes.forEach(btn => btn.disabled = true);
    btnSubmitPrediction.disabled = true;
    btnSubmitPrediction.innerText = "Predictions Locked";
    
  } else if (phase === "reveal") {
    matchStatus.className = "status-badge reveal";
    statusText.innerText = "Revealed";
    countdownLabel.innerText = "Match In Progress";
    
    btnOutcomes.forEach(btn => btn.disabled = true);
    btnSubmitPrediction.disabled = true;
    btnSubmitPrediction.innerText = "Match Started";
    
    if (!isMockMode) {
      startFirebasePrivatePredictions();
    }
  }
  
  renderVotersList();
}

function formatTimeDiff(ms) {
  const totalSecs = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  
  const pad = (num) => String(num).padStart(2, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

// ===============================================================
// Render Voters List UI
// ===============================================================

function renderVotersList() {
  votersListContainer.innerHTML = "";
  
  const voterCount = publicVoters.length;
  voterCountBadge.innerText = `${voterCount} ${voterCount === 1 ? 'Vote' : 'Votes'}`;
  
  if (voterCount === 0) {
    votersListContainer.innerHTML = '<div class="empty-voters">No votes cast yet. Be the first to predict!</div>';
    return;
  }
  
  const getPredictionText = (pred) => {
    if (pred === "Spain") return "🇪🇸 Spain";
    if (pred === "Belgium") return "🇧🇪 Belgium";
    return pred;
  };

  publicVoters.forEach((voter) => {
    const voterItem = document.createElement("div");
    voterItem.className = "voter-item";
    
    const voterInfo = document.createElement("div");
    voterInfo.className = "voter-info";
    
    const avatar = document.createElement("img");
    avatar.className = "voter-avatar";
    avatar.src = voter.photoURL || "https://api.dicebear.com/7.x/bottts/svg?seed=" + encodeURIComponent(voter.userId);
    avatar.alt = voter.displayName;
    
    const name = document.createElement("span");
    name.className = "voter-name";
    name.innerText = voter.displayName;
    
    voterInfo.appendChild(avatar);
    voterInfo.appendChild(name);
    
    const predictionBadge = document.createElement("div");
    
    const privateData = privatePredictions[voter.userId];
    const isSelf = currentUser && voter.userId === currentUser.uid;
    
    if (currentPhase === "pre") {
      if (isSelf && userPrediction) {
        predictionBadge.className = "voter-prediction revealed";
        predictionBadge.innerText = `You: ${getPredictionText(userPrediction)}`;
      } else {
        predictionBadge.className = "voter-prediction hidden";
        predictionBadge.innerHTML = '🤫 <span>Hidden</span>';
      }
    } else if (currentPhase === "locked") {
      if (isSelf && userPrediction) {
        predictionBadge.className = "voter-prediction revealed";
        predictionBadge.innerText = `You: ${getPredictionText(userPrediction)}`;
      } else {
        predictionBadge.className = "voter-prediction hidden";
        predictionBadge.innerHTML = '🔒 <span>Locked</span>';
      }
    } else if (currentPhase === "reveal") {
      if (privateData && privateData.prediction) {
        predictionBadge.className = "voter-prediction revealed-highlight";
        if (privateData.prediction === "Spain") {
          predictionBadge.style.color = "var(--flag-spain-yellow)";
          predictionBadge.style.borderColor = "var(--flag-spain-yellow)";
        } else if (privateData.prediction === "Belgium") {
          predictionBadge.style.color = "var(--flag-belgium-red)";
          predictionBadge.style.borderColor = "var(--flag-belgium-red)";
        } else {
          predictionBadge.style.color = "var(--accent-primary)";
          predictionBadge.style.borderColor = "var(--accent-primary)";
        }
        predictionBadge.innerText = getPredictionText(privateData.prediction);
      } else {
        predictionBadge.className = "voter-prediction hidden";
        predictionBadge.innerHTML = '🔒 <span>Locked</span>';
      }
    }
    
    voterItem.appendChild(voterInfo);
    voterItem.appendChild(predictionBadge);
    votersListContainer.appendChild(voterItem);
  });
}

// ===============================================================
// Simulator Controls Panel Actions
// ===============================================================

function toggleSimulatorCollapse() {
  simulatorBody.classList.toggle("collapsed");
  simulatorToggleBtn.innerText = simulatorBody.classList.contains("collapsed") ? "Expand" : "Collapse";
}

async function setMockKickoffOffset(offsetMs, isReset = false) {
  let targetTime;
  if (isReset) {
    targetTime = new Date(DEFAULT_KICKOFF_MS);
  } else {
    targetTime = new Date(Date.now() + offsetMs);
  }

  if (!isMockMode) {
    if (!currentUser) {
      showToast("Sign in required.");
      return;
    }
    const configRef = doc(db, "config", "game");
    try {
      await setDoc(configRef, {
        kickoffTime: Timestamp.fromDate(targetTime)
      }, { merge: true });
      showToast("Simulator kickoff updated!");
    } catch (e) {
      console.error(e);
      showToast("Failed to write to Firebase config.");
    }
  } else {
    // Mock Update
    const config = {
      kickoffTimeMs: targetTime.getTime(),
      teamA: "Spain",
      teamB: "Belgium"
    };
    localStorage.setItem("mock_config", JSON.stringify(config));
    mockEvents.emit("config_changed");
    showToast("Simulator kickoff updated locally!");
  }
}

function updateSimulationActiveBtn() {
  if (!gameConfig) return;
  
  btnSimPre.classList.remove("active");
  btnSimPost.classList.remove("active");
  btnSimReveal.classList.remove("active");
  btnSimReset.classList.remove("active");
  
  const kickoffMs = gameConfig.kickoffTime.toMillis();
  if (kickoffMs === DEFAULT_KICKOFF_MS) {
    btnSimReset.classList.add("active");
    return;
  }
  
  const now = Date.now();
  const diff = kickoffMs - now;
  
  if (diff > 0) {
    btnSimPre.classList.add("active");
  } else if (diff <= 0 && diff > -5 * 60 * 1000) {
    btnSimPost.classList.add("active");
  } else {
    btnSimReveal.classList.add("active");
  }
}

// ===============================================================
// Mock Voters Generation for Sandbox Testing
// ===============================================================

function generateMockVoters() {
  const mockNames = [
    { name: "Hazard Fries 🍟", pred: "Belgium", photo: "https://api.dicebear.com/7.x/adventurer/svg?seed=Hazard" },
    { name: "Torres Red 🇪🇸", pred: "Spain", photo: "https://api.dicebear.com/7.x/adventurer/svg?seed=Torres" },
    { name: "Kevin King 👑", pred: "Belgium", photo: "https://api.dicebear.com/7.x/adventurer/svg?seed=Kevin" },
    { name: "Cup Winner 🏆", pred: "Spain", photo: "https://api.dicebear.com/7.x/adventurer/svg?seed=Cup" }
  ];

  if (!isMockMode) {
    // Generate mock voters directly in Firebase Emulator
    mockNames.forEach(async (voter, idx) => {
      const uid = "mock_voter_" + idx;
      const publicDoc = doc(db, "predictions_public", uid);
      await setDoc(publicDoc, {
        userId: uid,
        displayName: voter.name,
        photoURL: voter.photo,
        votedAt: serverTimestamp()
      });
      const privateDoc = doc(db, "predictions_private", uid);
      await setDoc(privateDoc, {
        userId: uid,
        prediction: voter.pred,
        votedAt: serverTimestamp()
      });
    });
    showToast("Mock voters added to Firebase Emulator!");
  } else {
    // Generate mock voters in local storage
    const storedPublic = localStorage.getItem("mock_voters_public");
    let publicList = storedPublic ? JSON.parse(storedPublic) : [];
    
    const storedPrivate = localStorage.getItem("mock_voters_private");
    let privateMap = storedPrivate ? JSON.parse(storedPrivate) : {};

    mockNames.forEach((voter, idx) => {
      const uid = "mock_voter_" + idx;
      
      // Add if not already present
      if (!publicList.some(item => item.userId === uid)) {
        publicList.push({
          userId: uid,
          displayName: voter.name,
          photoURL: voter.photo,
          votedAtMs: Date.now() - (idx + 1) * 30 * 1000
        });

        privateMap[uid] = {
          userId: uid,
          prediction: voter.pred,
          votedAtMs: Date.now() - (idx + 1) * 30 * 1000
        };
      }
    });

    localStorage.setItem("mock_voters_public", JSON.stringify(publicList));
    localStorage.setItem("mock_voters_private", JSON.stringify(privateMap));

    // Emit updates
    mockEvents.emit("voters_changed");
    mockEvents.emit("private_changed");
    
    showToast("Mock voters generated! Check the pool.");
  }
}

// ===============================================================
// Notification Toasts
// ===============================================================

function showToast(message) {
  toastMessage.innerText = message;
  toast.classList.add("show");
  
  setTimeout(() => {
    toast.classList.remove("show");
  }, 3500);
}
