// =========================================================================
// KOSHA 폭염 예방 모바일 스마트 앱 - 프론트엔드 비즈니스 로직 (app.js) - 최종 통합본
// =========================================================================

// =========================================================================
// [1] Google Sheets Web App (GAS) 연동 설정
// =========================================================================
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyrqnZ6DGMxnj_4QbXffSnT1ANwni2mCiw0mOxf5hmsk4tammjsFa5lIJyV6c2LqDeTJQ/exec";

async function gasCall(payload) {
  if (!GAS_API_URL || GAS_API_URL.includes("REPLACE_WITH_YOUR_DEPLOYMENT_ID")) {
    throw new Error("GAS_API_URL이 설정되지 않았습니다.");
  }
  const res = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "follow"
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

const koshaActions = {
  "정상": "• 기본 수칙 준수 (물, 그늘, 휴식)",
  "관심": "• 온열질환 증상 교육\n• 충분한 수분 섭취 권장\n• 적절한 휴식",
  "주의": "• 근로자 건강상태 확인\n• 2시간 이내 20분 이상 휴식",
  "경고": "• 근로자 건강상태 확인\n• 오후 2시~5시 가급적 옥외작업 중지\n• 2시간 이내 20분 이상 휴식",
  "위험": "• 근로자 건강상태 확인\n• 2시간 이내 20분 이상 휴식\n• 필요시 작업 중단"
};

const dummySignature = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='40'><text x='10' y='25' font-family='sans-serif' font-size='12' fill='gray'>보건서명 완료</text></svg>";

let tempDb = [];
let checklistDb = [];
let tbmDb = [];
let emailDb = [];

const TBM_QUESTIONS = [
  { key: "q1", category: "self",      label: "[컨디션]",       text: "현재 가벼운 두통, 어지러움, 속 울렁거림 또는 무력감이 있습니까?",                       riskOnYes: true,  defaultVal: "아니오" },
  { key: "q2", category: "self",      label: "[건강상태]",     text: "현재 감기 기운(오한, 발열)이 있거나, 혈압·당뇨·이뇨제 등의 약을 복용 중입니까?",       riskOnYes: true,  defaultVal: "아니오" },
  { key: "q3", category: "self",      label: "[개인요인]",     text: "전날 과음을 하였거나, 수면 부족으로 오늘 유독 피로감이 심합니까?",                     riskOnYes: true,  defaultVal: "아니오" },
  { key: "q4", category: "self",      label: "[현장적응]",     text: "우리 현장에 신규 배치되었거나, 고온 환경 작업이 오랜만(또는 처음)입니까?",             riskOnYes: true,  defaultVal: "아니오" },
  { key: "q5", category: "observe",   label: "[외관 관찰]",    text: "얼굴이 유독 창백하거나 붉은 사람, 숨을 거칠게 쉬는 사람이 있는가?",                   riskOnYes: true,  defaultVal: "아니오" },
  { key: "q6", category: "observe",   label: "[행동 관찰]",    text: "대답이 눈에 띄게 굼뜨거나, 걸음걸이가 비틀거리는 사람이 있는가?",                     riskOnYes: true,  defaultVal: "아니오" },
  { key: "q7", category: "designate", label: "[특별관리대상]", text: "오늘 작업조에 민감군(고령자/유소견자/신규자 등) 지정 대상자가 있습니까?",            riskOnYes: false, defaultVal: "아니오" },
  { key: "q8", category: "pledge",    label: "[물 섭취 규칙]", text: "매 15~20분마다 시원한 물을 규칙적으로 마시겠습니다.",                                riskOnYes: false, defaultVal: "예" },
  { key: "q9", category: "pledge",    label: "[동료 관찰]",    text: "작업 중 옆 동료가 횡설수설하거나 비틀거리면 즉시 작업을 멈추고 관리자에게 알리겠습니다.", riskOnYes: false, defaultVal: "예" }
];

let activeSlot = "AM";
let selectedLocation = "시설 관리팀 작업실";
let currentTemp = 32.0;
let currentHumidity = 55;
let activeRemarks = "";
let activeInspector = "보건관리자";

let canvas, ctx;
let drawing = false;
let lastX = 0, lastY = 0;
let savedSignatureDataUrl = "";
let signContext = "temp";

// =========================================================================
// [2] 초기 구동 및 이벤트 바인딩
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  
  document.getElementById("m-input-record-date").value = dateStr;
  document.getElementById("m-input-checklist-date").value = dateStr;
  const tbmDateEl = document.getElementById("m-input-tbm-date");
  if (tbmDateEl) tbmDateEl.value = dateStr;

  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const timeEl = document.getElementById("m-input-record-time");
  if (timeEl) timeEl.value = hh + ':' + mi;

  initTbmScreen();
  initClock();
  initQRGenerator();
  initNavigation();
  initSubTabs();
  initSliders();
  initChecklistToggles();
  initSignaturePad();
  
  loadFromSheets().then(() => {
    renderArchive();
    if (typeof renderDashboard === "function") {
      renderDashboard();
      setDashboardSyncStatus(true);
    }
  }).catch(() => {
    if (typeof setDashboardSyncStatus === "function") setDashboardSyncStatus(false);
  });

  if (typeof startDashboardClock === "function") startDashboardClock();

  document.getElementById("btn-open-sign-modal").addEventListener("click", () => {
    signContext = "temp"; openSignModal();
  });
  document.getElementById("btn-close-sign").addEventListener("click", () => document.getElementById("sign-pad-modal").classList.remove("active"));
  document.getElementById("btn-close-viewer").addEventListener("click", () => document.getElementById("checklist-viewer-modal").classList.remove("active"));
  
  document.getElementById("btn-final-submit").addEventListener("click", submitRecordFinal);
  document.getElementById("btn-submit-checklist").addEventListener("click", () => {
    signContext = "checklist"; openSignModal();
  });
  
  document.getElementById("search-temp-date-start").addEventListener("change", renderArchive);
  document.getElementById("search-temp-date-end").addEventListener("change", renderArchive);
  document.getElementById("search-temp-loc").addEventListener("change", renderArchive);
  document.getElementById("search-check-date-start").addEventListener("change", renderArchive);
  document.getElementById("search-check-date-end").addEventListener("change", renderArchive);
  
  document.getElementById("chk-temp-all").addEventListener("change", (e) => {
    document.querySelectorAll(".chk-temp-print").forEach(chk => chk.checked = e.target.checked);
  });
  document.getElementById("chk-check-all").addEventListener("change", (e) => {
    document.querySelectorAll(".chk-check-print").forEach(chk => chk.checked = e.target.checked);
  });
  document.getElementById("btn-print-selected-temp").addEventListener("click", printSelectedTempRecords);
  document.getElementById("btn-print-selected-check").addEventListener("click", printSelectedChecklists);
  document.getElementById("btn-delete-selected-temp").addEventListener("click", deleteSelectedTempRecords);
  document.getElementById("btn-delete-selected-check").addEventListener("click", deleteSelectedChecklists);
  
  document.getElementById("m-input-location").addEventListener("change", (e) => {
    const otherInput = document.getElementById("m-input-location-other");
    if (e.target.value === "기타 작업장") {
      otherInput.style.display = "block";
      selectedLocation = otherInput.value || "기타 작업장";
    } else {
      otherInput.style.display = "none";
      selectedLocation = e.target.value;
    }
  });

  document.getElementById("m-input-location-other").addEventListener("input", (e) => {
    if (document.getElementById("m-input-location").value === "기타 작업장") {
      selectedLocation = e.target.value || "기타 작업장";
    }
  });
  document.getElementById("m-input-remarks").addEventListener("input", (e) => activeRemarks = e.target.value);
});

function initClock() {
  const clockEl = document.getElementById("phone-time");
  setInterval(() => {
    const now = new Date();
    clockEl.innerText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }, 1000);
}

function initQRGenerator() {
  const qrDisplay = document.getElementById("qr-code-display");
  const liveUrlText = document.getElementById("live-url-text");
  const currentUrl = window.location.href;
  liveUrlText.innerText = currentUrl;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(currentUrl)}&color=0f172a`;
  qrDisplay.innerHTML = `<img src="${qrApiUrl}" alt="로컬 접속 QR 코드" title="스마트폰으로 스캔하세요">`;
}

function initNavigation() {
  const navItems = document.querySelectorAll(".app-navbar .nav-item");
  const screens = document.querySelectorAll(".app-screen");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(i => i.classList.remove("active"));
      screens.forEach(s => s.classList.remove("active"));
      item.classList.add("active");
      const targetScreen = item.getAttribute("data-screen");
      document.getElementById(targetScreen).classList.add("active");
      if (targetScreen === "screen-archive") renderArchive();
      if (targetScreen === "screen-tbm") {
        const tbmBox = document.getElementById("tbm-items-container");
        if (tbmBox && tbmBox.children.length === 0) initTbmScreen();
      }
    });
  });
}

function initSubTabs() {
  const subBtns = document.querySelectorAll(".archive-sub-tabs .sub-tab-btn");
  const panes = document.querySelectorAll(".archive-sub-pane");
  subBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      subBtns.forEach(b => b.classList.remove("active"));
      panes.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.getAttribute("data-sub")).classList.add("active");
    });
  });
}

function initSliders() {
  const tSlider = document.getElementById("m-input-temp");
  const hSlider = document.getElementById("m-input-humidity");
  const tVal = document.getElementById("m-val-temp");
  const hVal = document.getElementById("m-val-humidity");

  tSlider.addEventListener("input", (e) => { currentTemp = parseFloat(e.target.value); tVal.value = currentTemp.toFixed(1); calculatePerceivedMobile(); });
  tVal.addEventListener("input", (e) => { let val = parseFloat(e.target.value); if (!isNaN(val)) { currentTemp = val; tSlider.value = val; calculatePerceivedMobile(); } });
  hSlider.addEventListener("input", (e) => { currentHumidity = parseInt(e.target.value); hVal.value = currentHumidity; calculatePerceivedMobile(); });
  hVal.addEventListener("input", (e) => { let val = parseInt(e.target.value); if (!isNaN(val)) { currentHumidity = val; hSlider.value = val; calculatePerceivedMobile(); } });
  calculatePerceivedMobile();
}

function calculatePerceivedMobile() {
  const perceived = Math.round((currentTemp + 0.14 * (currentHumidity - 50)) * 10) / 10;
  let stage = "정상", color = "var(--color-normal)", badgeClass = "badge-normal";
  if (perceived >= 38) { stage = "위험"; color = "var(--color-danger)"; badgeClass = "badge-danger"; }
  else if (perceived >= 35) { stage = "경고"; color = "var(--color-warning)"; badgeClass = "badge-warning"; }
  else if (perceived >= 33) { stage = "주의"; color = "var(--color-attention)"; badgeClass = "badge-attention"; }
  else if (perceived >= 31) { stage = "관심"; color = "var(--color-interest)"; badgeClass = "badge-interest"; }

  document.getElementById("m-calc-perceived").innerText = `${perceived.toFixed(1)} ℃`;
  document.getElementById("m-calc-perceived").style.color = color;
  document.getElementById("m-calc-stage").innerText = stage;
  document.getElementById("m-calc-stage").className = `badge ${badgeClass}`;
  document.getElementById("m-calc-action").innerHTML = koshaActions[stage].replace(/\n/g, "<br>");
  
  const previewBox = document.getElementById("m-preview-box");
  previewBox.style.borderColor = color;
  previewBox.style.backgroundColor = `rgba(${color === 'var(--color-normal)' ? '59,130,246' : color === 'var(--color-interest)' ? '6,182,212' : color === 'var(--color-attention)' ? '234,179,8' : color === 'var(--color-warning)' ? '249,115,22' : '239,68,68'}, 0.04)`;
}

function initChecklistToggles() {
  const rows = document.querySelectorAll(".checklist-items-group .chk-item-row");
  rows.forEach(row => {
    const buttons = row.querySelectorAll(".yn-btn");
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        buttons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (btn.getAttribute("data-val") === "개선필요") row.classList.add("failure-highlight");
        else row.classList.remove("failure-highlight");
      });
    });
  });
}

function initSignaturePad() {
  canvas = document.getElementById("signature-canvas");
  ctx = canvas.getContext("2d");
  resizeSignatureCanvas();
  window.addEventListener("resize", debounce(resizeSignatureCanvas, 150));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", debounce(resizeSignatureCanvas, 150));
  
  ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";

  canvas.addEventListener("mousedown", (e) => { drawing = true; [lastX, lastY] = getCoordinates(e); });
  canvas.addEventListener("mousemove", (e) => { if (!drawing) return; draw(e); });
  canvas.addEventListener("mouseup", () => drawing = false);
  canvas.addEventListener("mouseleave", () => drawing = false);
  canvas.addEventListener("touchstart", (e) => { drawing = true; [lastX, lastY] = getCoordinates(e.touches[0]); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { if (!drawing) return; draw(e.touches[0]); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", (e) => { drawing = false; e.preventDefault(); }, { passive: false });

  document.getElementById("btn-clear-canvas").addEventListener("click", clearCanvas);
  document.getElementById("btn-save-signature").addEventListener("click", saveSignature);
}

function resizeSignatureCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  let backup = null;
  if (canvas.width > 0 && canvas.height > 0) { try { backup = canvas.toDataURL(); } catch(_) {} }
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (backup) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src =
