// =========================================================================
// KOSHA 폭염 예방 모바일 스마트 앱 - 프론트엔드 비즈니스 로직 (app.js) - 최종 통합본
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

let canvas, ctx, drawing = false, lastX = 0, lastY = 0, savedSignatureDataUrl = "", signContext = "temp";

// =========================================================================
// [초기 구동 리스너 및 렌더러 바인딩]
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  if(document.getElementById("m-input-record-date")) document.getElementById("m-input-record-date").value = dateStr;
  if(document.getElementById("m-input-checklist-date")) document.getElementById("m-input-checklist-date").value = dateStr;
  if(document.getElementById("m-input-tbm-date")) document.getElementById("m-input-tbm-date").value = dateStr;

  const timeEl = document.getElementById("m-input-record-time");
  if (timeEl) timeEl.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

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
    if (typeof renderDashboard === "function") { renderDashboard(); setDashboardSyncStatus(true); }
  }).catch((e) => {
    console.error("데이터 로드 실패:", e);
    if (typeof setDashboardSyncStatus === "function") setDashboardSyncStatus(false);
  });

  if (typeof startDashboardClock === "function") startDashboardClock();

  document.getElementById("btn-open-sign-modal")?.addEventListener("click", () => { signContext = "temp"; openSignModal(); });
  document.getElementById("btn-close-sign")?.addEventListener("click", () => document.getElementById("sign-pad-modal").classList.remove("active"));
  document.getElementById("btn-close-viewer")?.addEventListener("click", () => document.getElementById("checklist-viewer-modal").classList.remove("active"));
  document.getElementById("btn-final-submit")?.addEventListener("click", submitRecordFinal);
  document.getElementById("btn-submit-checklist")?.addEventListener("click", () => { signContext = "checklist"; openSignModal(); });
  
  // 모바일 탭 기간 검색
  document.getElementById("search-temp-date-start")?.addEventListener("change", renderArchive);
  document.getElementById("search-temp-date-end")?.addEventListener("change", renderArchive);
  document.getElementById("search-temp-loc")?.addEventListener("change", renderArchive);
  document.getElementById("search-check-date-start")?.addEventListener("change", renderArchive);
  document.getElementById("search-check-date-end")?.addEventListener("change", renderArchive);

  // PC 대시보드 기간 검색
  document.getElementById("dash-filter-temp-start")?.addEventListener("change", _renderDashTempList);
  document.getElementById("dash-filter-temp-end")?.addEventListener("change", _renderDashTempList);
  document.getElementById("dash-filter-tbm-start")?.addEventListener("change", _renderDashTbmList);
  document.getElementById("dash-filter-tbm-end")?.addEventListener("change", _renderDashTbmList);
  document.getElementById("dash-filter-check-start")?.addEventListener("change", _renderDashCheckList);
  document.getElementById("dash-filter-check-end")?.addEventListener("change", _renderDashCheckList);
  
  // 전체 선택 및 일괄 인쇄 버튼
  document.getElementById("chk-temp-all")?.addEventListener("change", (e) => { document.querySelectorAll(".chk-temp-print").forEach(chk => chk.checked = e.target.checked); });
  document.getElementById("chk-check-all")?.addEventListener("change", (e) => { document.querySelectorAll(".chk-check-print").forEach(chk => chk.checked = e.target.checked); });
  document.getElementById("btn-print-selected-temp")?.addEventListener("click", printSelectedTempRecords);
  document.getElementById("btn-print-selected-check")?.addEventListener("click", printSelectedChecklists);
  document.getElementById("btn-delete-selected-temp")?.addEventListener("click", deleteSelectedTempRecords);
  document.getElementById("btn-delete-selected-check")?.addEventListener("click", deleteSelectedChecklists);
  
  document.getElementById("m-input-location")?.addEventListener("change", (e) => {
    const otherInput = document.getElementById("m-input-location-other");
    if (e.target.value === "기타 작업장") { otherInput.style.display = "block"; selectedLocation = otherInput.value || "기타 작업장"; } 
    else { otherInput.style.display = "none"; selectedLocation = e.target.value; }
  });
  document.getElementById("m-input-location-other")?.addEventListener("input", (e) => {
    if (document.getElementById("m-input-location").value === "기타 작업장") selectedLocation = e.target.value || "기타 작업장";
  });
  document.getElementById("m-input-remarks")?.addEventListener("input", (e) => activeRemarks = e.target.value);
});

function initClock() {
  setInterval(() => {
    const now = new Date();
    const el = document.getElementById("phone-time");
    if(el) el.innerText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }, 1000);
}

function initQRGenerator() {
  const qrDisplay = document.getElementById("qr-code-display");
  const liveUrlText = document.getElementById("live-url-text");
  if(!qrDisplay || !liveUrlText) return;
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
  if(!tSlider || !hSlider) return;

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

  const pEl = document.getElementById("m-calc-perceived");
  if(pEl) { pEl.innerText = `${perceived.toFixed(1)} ℃`; pEl.style.color = color; }
  const sEl = document.getElementById("m-calc-stage");
  if(sEl) { sEl.innerText = stage; sEl.className = `badge ${badgeClass}`; }
  const aEl = document.getElementById("m-calc-action");
  if(aEl) { aEl.innerHTML = koshaActions[stage].replace(/\n/g, "<br>"); }
  const boxEl = document.getElementById("m-preview-box");
  if(boxEl) {
    boxEl.style.borderColor = color;
    boxEl.style.backgroundColor = `rgba(${color === 'var(--color-normal)' ? '59,130,246' : color === 'var(--color-interest)' ? '6,182,212' : color === 'var(--color-attention)' ? '234,179,8' : color === 'var(--color-warning)' ? '249,115,22' : '239,68,68'}, 0.04)`;
  }
}

function initChecklistToggles() {
  document.querySelectorAll(".checklist-items-group .chk-item-row").forEach(row => {
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
  if(!canvas) return;
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

  document.getElementById("btn-clear-canvas")?.addEventListener("click", clearCanvas);
  document.getElementById("btn-save-signature")?.addEventListener("click", saveSignature);
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
    img.src = backup;
  }
}

function debounce(fn, delay) {
  let timer = null;
  return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); };
}

function getCoordinates(event) {
  const rect = canvas.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

function draw(event) {
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  const [x, y] = getCoordinates(event);
  ctx.lineTo(x, y);
  ctx.stroke();
  [lastX, lastY] = [x, y];
}

function clearCanvas() {
  if (!canvas || !ctx) return;
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore();
}

function saveSignature() {
  savedSignatureDataUrl = canvas.toDataURL();
  if (signContext === "tbm") { document.getElementById("sign-pad-modal").classList.remove("active"); submitTbm(); return; }
  if (signContext === "checklist") { document.getElementById("sign-pad-modal").classList.remove("active"); submitChecklist(); return; }

  const perceived = Math.round((currentTemp + 0.14 * (currentHumidity - 50)) * 10) / 10;
  let stage = "정상";
  if (perceived >= 38) stage = "위험"; else if (perceived >= 35) stage = "경고"; else if (perceived >= 33) stage = "주의"; else if (perceived >= 31) stage = "관심";

  document.getElementById("c-loc").innerText = selectedLocation;
  document.getElementById("c-temp").innerText = `${currentTemp.toFixed(1)} ℃`;
  document.getElementById("c-hum").innerText = `${currentHumidity} %`;
  
  const cPerc = document.getElementById("c-perceived");
  cPerc.innerText = `${perceived.toFixed(1)} ℃`;
  
  const colors = { "정상": "var(--color-normal)", "관심": "var(--color-interest)", "주의": "var(--color-attention)", "경고": "var(--color-warning)", "위험": "var(--color-danger)" };
  cPerc.style.color = colors[stage];
  const badgeMap = { "정상": "badge-normal", "관심": "badge-interest", "주의": "badge-attention", "경고": "badge-warning", "위험": "badge-danger" };
  const cStg = document.getElementById("c-stage");
  cStg.innerText = stage; cStg.className = `badge ${badgeMap[stage]}`;
  document.getElementById("c-action-text").innerHTML = koshaActions[stage].replace(/\n/g, "<br>");
  document.getElementById("capture-sign-img").src = savedSignatureDataUrl;

  document.getElementById("sign-pad-modal").classList.remove("active");
  document.getElementById("result-confirm-modal").classList.add("active");
}

function openSignModal() {
  savedSignatureDataUrl = "";
  document.getElementById("sign-pad-modal").classList.add("active");
  setTimeout(() => {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) { canvas.width  = rect.width * dpr; canvas.height = rect.height * dpr; ctx.scale(dpr, dpr); }
    clearCanvas();
  }, 150);
}

function updateMissingRecordsWidget() { return; }

// =========================================================================
// [제출 및 데이터 동기화]
// =========================================================================
function submitRecordFinal() {
  const perceived = Math.round((currentTemp + 0.14 * (currentHumidity - 50)) * 10) / 10;
  let stage = "정상";
  if (perceived >= 38) stage = "위험"; else if (perceived >= 35) stage = "경고"; else if (perceived >= 33) stage = "주의"; else if (perceived >= 31) stage = "관심";

  const newId = `TMP-${100 + tempDb.length + 1}`;
  const now = new Date();
  let dateStr = document.getElementById("m-input-record-date").value || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let timeStr = document.getElementById("m-input-record-time")?.value || now.toTimeString().split(' ')[0].substring(0, 5);
  
  const timeHour = parseInt(timeStr.split(':')[0], 10);
  const derivedSlot = timeHour < 12 ? "AM" : "PM";
  const packedSlot = `${derivedSlot}|${timeStr}|${dateStr}`;

  const record = {
    id: newId, date: dateStr, "측정날짜": dateStr, time: timeStr, "측정시간": timeStr, slot: packedSlot,
    inspector: activeInspector, location: selectedLocation,
    temp: currentTemp, humidity: currentHumidity, perceived: perceived,
    stage: stage, action: koshaActions[stage], signature: savedSignatureDataUrl,
    remarks: activeRemarks || "모바일에서 작성 완료 (이상 없음)"
  };

  const submitBtn = document.getElementById("btn-final-submit");
  submitBtn.disabled = true; submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sheets 데이터 적재 중...`;

  setTimeout(async () => {
    try {
      const res = await gasCall({ action: "create", target: "temp", record: record });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
      if (res.id) record.id = res.id;
    } catch (err) {
      submitBtn.disabled = false; submitBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> 구글 시트 전송 & 관리자 경고 메일 발송`;
      alert("⚠️ 구글 시트 저장 실패\n" + err.message); return;
    }

    const localRecord = { ...record, slot: derivedSlot };
    tempDb.unshift(localRecord);
    
    submitBtn.disabled = false; submitBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> 구글 시트 전송 & 관리자 경고 메일 발송`;
    document.getElementById("result-confirm-modal").classList.remove("active");
    document.getElementById("m-input-remarks").value = ""; activeRemarks = "";

    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    document.querySelectorAll(".app-screen").forEach(s => s.classList.remove("active"));
    document.querySelector(".nav-item[data-screen='screen-archive']").classList.add("active");
    document.getElementById("screen-archive").classList.add("active");

    renderArchive();
    triggerMockGas(localRecord);
    alert(`[기록 저장 완료] ${selectedLocation} 체감온도 기록지가 성공적으로 저장되었습니다.`);
  }, 1000);
}

function submitChecklist() {
  const remarks = document.getElementById("chk-input-remarks").value || "보완사항 없음. 준수 완료.";
  const newId = `CHK-${100 + checklistDb.length + 1}`;
  const now = new Date();
  let dateStr = document.getElementById("m-input-checklist-date").value || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const record = { 
    id: newId, 
    date: dateStr, 
    "점검날짜": dateStr, 
    remarks: remarks, 
    signature: savedSignatureDataUrl 
  };
  
  const keys = ["water_supply","shade_cooling","shade_minimize","rest_facility","rest_31","rest_33","cooling_gear","emergency_unconscious","emergency_conscious","other_thermometer","other_education","other_record","other_sensitive"];
  keys.forEach(k => {
    const keyDash = k.replace('_', '-');
    record[k] = document.querySelector(`.chk-item-row[data-key='${keyDash}'] .yn-btn.active`).getAttribute("data-val");
  });

  const submitBtn = document.getElementById("btn-submit-checklist");
  submitBtn.disabled = true; submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 자율점검 DB 등록 중...`;

  setTimeout(async () => {
    try {
      const res = await gasCall({ action: "create", target: "checklist", record: record });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
      if (res.id) record.id = res.id;
    } catch (err) {
      submitBtn.disabled = false; submitBtn.innerHTML = `<i class="fa-solid fa-pen-nib"></i> 기록 및 전자 서명하기`;
      alert("⚠️ 구글 시트 저장 실패\n" + err.message); return;
    }

    checklistDb.unshift(record);
    submitBtn.disabled = false; submitBtn.innerHTML = `<i class="fa-solid fa-pen-nib"></i> 기록 및 전자 서명하기`;

    document.getElementById("chk-input-remarks").value = "";
    document.querySelectorAll(".checklist-items-group .chk-item-row").forEach(row => {
      row.classList.remove("failure-highlight");
      row.querySelectorAll(".yn-btn").forEach(b => b.classList.remove("active"));
      row.querySelector(".yn-btn[data-val='적정']").classList.add("active");
    });

    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    document.querySelectorAll(".app-screen").forEach(s => s.classList.remove("active"));
    document.querySelector(".nav-item[data-screen='screen-archive']").classList.add("active");
    document.getElementById("screen-archive").classList.add("active");

    document.querySelectorAll(".archive-sub-tabs .sub-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".archive-sub-pane").forEach(p => p.classList.remove("active"));
    document.querySelector(".sub-tab-btn[data-sub='sub-check']").classList.add("active");
    document.getElementById("sub-check").classList.add("active");

    renderArchive();
    alert(`[주간 점검 완료] ${dateStr} 자율점검표가 DB에 등록되었습니다.`);
  }, 1000);
}

// =========================================================================
// [데이터 로드 (패킹 파싱)]
// =========================================================================
async function loadFromSheets() {
  try {
    const results = await Promise.allSettled([
      gasCall({ action: "list", target: "temp" }),
      gasCall({ action: "list", target: "checklist" }),
      gasCall({ action: "list", target: "tbm" })
    ]);

    const [tempSettled, chkSettled, tbmSettled] = results;
    const tempRes = tempSettled.status === "fulfilled" ? tempSettled.value : null;
    const chkRes  = chkSettled.status  === "fulfilled" ? chkSettled.value  : null;
    const tbmRes  = tbmSettled.status  === "fulfilled" ? tbmSettled.value  : null;

    const pick = (r, key) => {
      if (r[key] !== undefined) return r[key];
      for (const k of Object.keys(r)) { if (String(k).trim() === key) return r[k]; }
      return undefined;
    };

    if (tempRes && tempRes.ok && Array.isArray(tempRes.records)) {
      tempDb = tempRes.records.filter(r => pick(r, "ID")).map(r => {
        const rawSlot = String(pick(r, "시간슬롯") || "AM");
        let realSlot = rawSlot, packedTime = "", packedDate = "";
        if (rawSlot.includes("|")) {
          const parts = rawSlot.split("|");
          realSlot = parts[0]; 
          if (parts.length > 1) packedTime = parts[1];
          if (parts.length > 2) packedDate = parts[2];
        }
        const finalDate = pick(r, "측정날짜") || pick(r, "날짜") || packedDate || _formatDateOnly(pick(r, "기록일시"));
        const finalTime = pick(r, "측정시간") || pick(r, "시간") || pick(r, "time") || packedTime || _formatTimeOnly(pick(r, "기록일시"));
        return {
          id: String(pick(r, "ID")), date: finalDate, slot: realSlot, time: finalTime,
          inspector: pick(r, "측정자") || "보건관리자", location: pick(r, "측정 장소") || "",
          temp: parseFloat(pick(r, "기온")) || 0, humidity: parseFloat(pick(r, "습도")) || 0,
          perceived: parseFloat(pick(r, "체감온도")) || 0, stage: pick(r, "폭염 단계") || "정상",
          action: koshaActions[pick(r, "폭염 단계")] || koshaActions["정상"], signature: pick(r, "서명") || dummySignature, remarks: pick(r, "특이사항") || ""
        };
      }).sort((a, b) => {
        const dtA = `${a.date || ''} ${a.time || ''}`; const dtB = `${b.date || ''} ${b.time || ''}`;
        return dtA.localeCompare(dtB); 
      });
    }

    if (chkRes && chkRes.ok && Array.isArray(chkRes.records)) {
      checklistDb = chkRes.records.filter(r => pick(r, "ID")).map(r => ({
        id: String(pick(r, "ID")), date: _formatDateOnly(pick(r, "점검날짜") || pick(r, "점검일시")),
        water_supply: pick(r, "물_식수제공") || "적정", shade_cooling: pick(r, "그늘_냉방그늘막") || "적정", shade_minimize: pick(r, "그늘_노출최소화") || "적정", rest_facility: pick(r, "휴식_휴게시설") || "적정", rest_31: pick(r, "휴식_31도휴식") || "적정", rest_33: pick(r, "휴식_33도휴식") || "적정", cooling_gear: pick(r, "보냉장구_개인지급") || "적정", emergency_unconscious: pick(r, "응급조치_무의식신고") || "적정", emergency_conscious: pick(r, "응급조치_의식응급조치") || "적정", other_thermometer: pick(r, "그외_온습도계") || "적정", other_education: pick(r, "그외_안전교육") || "적정", other_record: pick(r, "그외_기록보관") || "적정", other_sensitive: pick(r, "그외_민감군계획") || "적정", remarks: pick(r, "특이사항") || "", signature: pick(r, "서명") || ""
      })).sort((a, b) => (a.date||'').localeCompare(b.date||''));
    }

    if (tbmRes && tbmRes.ok && Array.isArray(tbmRes.records)) {
      tbmDb = tbmRes.records.filter(r => pick(r, "ID")).map(r => ({
        id: String(pick(r, "ID")), date: _formatDateOnly(pick(r, "작성날짜") || pick(r, "작성일시")),
        dept: pick(r, "작성부서") || pick(r, "부서") || pick(r, "작성 부서") || "",
        inspector: pick(r, "작성자") || "보건관리자", q1: pick(r, "Q1_컨디션") || "아니오", q2: pick(r, "Q2_건강상태") || "아니오", q3: pick(r, "Q3_개인요인") || "아니오", q4: pick(r, "Q4_현장적응") || "아니오", q5: pick(r, "Q5_외관관찰") || "아니오", q6: pick(r, "Q6_행동관찰") || "아니오", q7: pick(r, "Q7_특별관리") || "아니오", q8: pick(r, "Q8_물섭취서약") || "예", q9: pick(r, "Q9_동료관찰서약")|| "예", remarks: pick(r, "특이사항") || "", signature: pick(r, "서명") || ""
      })).sort((a, b) => (a.date||'').localeCompare(b.date||''));
    }

    if (!tempRes && !chkRes && !tbmRes) { alert("⚠️ Google Sheets 데이터 로드 실패\n네트워크 또는 GAS Web App URL을 확인해주세요."); }
  } catch (error) {
    console.error("데이터 로드 중 에러 발생:", error);
  }
}

function _formatDateOnly(val) {
  if (!val) return "";
  const d = new Date(val);
  if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const s = String(val); return s.substring(0, 10);
}

function _formatTimeOnly(val) {
  if (!val) return "00:00";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "00:00";
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// =========================================================================
// [렌더링 및 출력 로직]
// =========================================================================
function renderArchive() {
  const tempContainer = document.getElementById("archive-temp-list");
  if(tempContainer) {
    tempContainer.innerHTML = "";
    const tempStart = document.getElementById("search-temp-date-start")?.value || "";
    const tempEnd = document.getElementById("search-temp-date-end")?.value || "";
    const tempLoc = document.getElementById("search-temp-loc")?.value || "전체";

    const filteredTempDb = tempDb.filter(row => {
      if (tempStart && row.date < tempStart) return false;
      if (tempEnd && row.date > tempEnd) return false;
      if (tempLoc !== "전체" && row.location !== tempLoc) return false;
      return true;
    });

    filteredTempDb.forEach(row => {
      const card = document.createElement("div");
      card.className = "temp-record-item-card";
      const slotKor = row.slot === "AM" ? "오전" : "오후";
      const dateFormatted = row.date.substring(5).replace('-', '.');
      const tempId = String(row.id);
      card.innerHTML = `<div class="t-rec-top"><span class="tr-dt" style="display:flex; align-items:center;"><input type="checkbox" class="chk-item-print chk-temp-print" data-id="${tempId}"><i class="fa-regular fa-calendar-check" style="margin-left: 5px; margin-right: 5px;"></i> ${dateFormatted} (${slotKor})</span><span class="tr-time" style="color:#2563eb; font-weight:600;">${row.time} 측정</span></div><div class="t-rec-body"><span class="tr-vals">${row.location}</span><span class="badge ${row.stage === '정상' ? 'badge-normal' : row.stage === '관심' ? 'badge-interest' : row.stage === '주의' ? 'badge-attention' : row.stage === '경고' ? 'badge-warning' : 'badge-danger'}">${row.stage}</span></div><div class="t-rec-footer"><div class="t-rec-sign-thumb"><img src="${row.signature}" alt="서명"></div><div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;"><span style="font-size: 9px; color:var(--text-muted); font-weight: bold;">체감온도: ${row.perceived.toFixed(1)}℃</span><button class="m-btn m-btn-blue btn-print-temp" style="margin: 0; padding: 4px 8px; font-size: 10px;" data-id="${tempId}"><i class="fa-solid fa-file-pdf"></i> 개별 출력</button></div></div>`;
      tempContainer.appendChild(card);
    });
  }

  const checkContainer = document.getElementById("archive-check-list");
  if(checkContainer) {
    checkContainer.innerHTML = "";
    const checkStart = document.getElementById("search-check-date-start")?.value || "";
    const checkEnd = document.getElementById("search-check-date-end")?.value || "";

    const filteredChecklistDb = checklistDb.filter(row => {
      if (checkStart && row.date < checkStart) return false;
      if (checkEnd && row.date > checkEnd) return false;
      return true;
    });

    const CHECK_KEYS = ["water_supply","shade_cooling","shade_minimize","rest_facility","rest_31","rest_33","cooling_gear","emergency_unconscious","emergency_conscious","other_thermometer","other_education","other_record","other_sensitive"];
    filteredChecklistDb.forEach(row => {
      const flagCount = CHECK_KEYS.filter(k => row[k] === "개선필요").length;
      const overall = flagCount >= 1 ? '주의' : '정상';
      const badgeCls = flagCount >= 1 ? 'badge-attention' : 'badge-normal';

      const rowDiv = document.createElement("div");
      rowDiv.className = "archive-card-compact";
      rowDiv.innerHTML = `<div class="acc-left"><input type="checkbox" class="chk-item-print chk-check-print" data-id="${row.id}"><span class="acc-date">${row.date}</span><span class="card-slot-chip">자율점검</span></div><div class="acc-mid"><img class="acc-sign" src="${row.signature || dummySignature}" alt="서명"></div><div class="acc-right"><span class="badge ${badgeCls}">${overall}</span><button class="acc-pdf-btn btn-print-check" data-id="${row.id}"><i class="fa-solid fa-file-pdf"></i></button></div>`;

      rowDiv.addEventListener("click", (e) => { if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return; openChecklistViewer(row); });
      const printBtn = rowDiv.querySelector(".btn-print-check");
      if (printBtn) {
        printBtn.addEventListener("click", (e) => {
          e.stopPropagation(); document.querySelectorAll(".chk-check-print").forEach(chk => chk.checked = false);
          rowDiv.querySelector(".chk-check-print").checked = true; printSelectedChecklists();
        });
      }
      checkContainer.appendChild(rowDiv);
    });
  }

  const chkTempAll = document.getElementById("chk-temp-all"); if(chkTempAll) chkTempAll.checked = false;
  const chkCheckAll = document.getElementById("chk-check-all"); if(chkCheckAll) chkCheckAll.checked = false;

  document.querySelectorAll(".btn-print-temp").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); const tempId = btn.getAttribute("data-id");
      document.querySelectorAll(".chk-temp-print").forEach(chk => chk.checked = false);
      const targetChk = document.querySelector(`.chk-temp-print[data-id="${tempId}"]`);
      if(targetChk) targetChk.checked = true; printSelectedTempRecords();
    });
  });

  renderTbmArchiveList();
  if (typeof renderDashboard === "function") renderDashboard();
}

function openChecklistViewer(row) {
  document.getElementById("view-date").innerText = row.date; document.getElementById("view-remarks").innerText = row.remarks;
  const itemsContainer = document.getElementById("viewer-check-items"); itemsContainer.innerHTML = "";
  const checklistMapping = [
    { label: "1-1. 시원하고 깨끗한 물을 충분히 제공", value: row.water_supply }, { label: "2-1. 실내·옥외작업 시 냉방·통풍장치 및 그늘막 설치", value: row.shade_cooling }, { label: "2-2. 폭염 집중 시간대 노출 최소화", value: row.shade_minimize }, { label: "3-1. 작업장소 근처 휴게시설 설치 및 물품 비치", value: row.rest_facility }, { label: "3-2. 체감온도 31도 이상 폭염작업 시 적절한 휴식", value: row.rest_31 }, { label: "3-3. 체감온도 33도 이상 폭염작업 시 2시간 이내 20분 이상 휴식", value: row.rest_33 }, { label: "4-1. 개인 보냉장구 지급", value: row.cooling_gear }, { label: "5-1. 온열질환 의심자 무의식 시 즉시 119 신고", value: row.emergency_unconscious }, { label: "5-2. 의식 있을 시 응급조치 후 증상 미개선 시 119 신고", value: row.emergency_conscious }, { label: "6-1. 작업장소의 체감온도 온습도계 비치", value: row.other_thermometer }, { label: "6-2. 온열질환 증상 및 예방교육 실시", value: row.other_education }, { label: "6-3. 체감온도 측정 및 조치사항 기록·보관", value: row.other_record }, { label: "6-4. 온열질환 민감군 관리계획 수립", value: row.other_sensitive }
  ];
  checklistMapping.forEach(item => {
    const rowItem = document.createElement("div"); rowItem.className = "view-item-badge-row";
    let badgeClass = "val-적정"; if (item.value === "개선필요") badgeClass = "val-개선필요"; else if (item.value === "해당없음") badgeClass = "val-해당없음";
    rowItem.innerHTML = `<span class="itm-lbl">${item.label}</span><span class="itm-val-badge ${badgeClass}">${item.value}</span>`;
    itemsContainer.appendChild(rowItem);
  });
  document.getElementById("checklist-viewer-modal").classList.add("active");
}

function triggerMockGas(record) {
  if (record.perceived >= 33) { emailDb.push({ sender: "KOSHA 스마트봇", sub: `🚨 [폭염경보 - ${record.stage}] ${record.location} 감지` }); }
}

function printSelectedTempRecords() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-temp-print:checked")).map(chk => chk.getAttribute("data-id"));
  if (selectedIds.length === 0) { alert("출력할 체감기록을 선택해주세요."); return; }
  const records = tempDb.filter(r => selectedIds.includes(String(r.id))).sort((a, b) => {
    const dtA = `${a.date||''} ${a.time||''}`; const dtB = `${b.date||''} ${b.time||''}`; return dtA.localeCompare(dtB);
  });
  const printArea = document.getElementById("print-area");
  const uniqueMonths = [...new Set(records.map(r => r.date.substring(5,7)))]; const monthStr = uniqueMonths.length === 1 ? uniqueMonths[0] : "다중 선택";
  const uniqueLocs = [...new Set(records.map(r => r.location))]; const locStr = uniqueLocs.length === 1 ? uniqueLocs[0] : "기간/부서별 전체 장소";

  let rowsHtml = '';
  records.forEach(r => {
    const isNormal = r.perceived < 31; const isInterest = r.perceived >= 31 && r.perceived < 33; const isAttention = r.perceived >= 33 && r.perceived < 35; const isWarning = r.perceived >= 35 && r.perceived < 38; const isDanger = r.perceived >= 38;
    rowsHtml += `<tr><td>${r.date.substring(5).replace('-', '.')}</td><td>${r.time}</td><td style="font-size:9px;">${r.location || ''}</td><td>${r.temp.toFixed(1)}</td><td>${r.humidity}</td><td>${r.perceived.toFixed(2)}</td><td>${isNormal ? '√' : ''}</td><td>${isInterest ? '√' : ''}</td><td>${isAttention ? '√' : ''}</td><td>${isWarning ? '√' : ''}</td><td>${isDanger ? '√' : ''}</td><td style="text-align: left; font-size: 10px;">${r.action}</td><td style="font-size: 10px;">${r.remarks.includes("모바일") ? "" : r.remarks}</td></tr>`;
  });
  const emptyRowsNeeded = Math.max(0, 15 - records.length);
  for(let i=0; i<emptyRowsNeeded; i++) rowsHtml += `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;

  printArea.innerHTML = `<div class="kosha-print-title">체감온도 기록지</div><div class="kosha-print-info"><div style="text-align: center; font-size: 14px; font-weight: bold; margin-bottom: 10px;">( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${monthStr} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)월</div>❖ 작성 기준 : ■ 2회/일 (체크시간: 오전 10시 / 오후 2시) &nbsp;&nbsp;&nbsp; □ 작업 전 측정<br>❖ 측정 장소 : ■ ${locStr} <br>❖ 보관기한: 당해 연도 12월 31일까지</div><table class="kosha-print-table"><thead><tr><th rowspan="2" width="6%">날짜</th><th rowspan="2" width="6%">시간</th><th rowspan="2" width="12%">측정장소</th><th colspan="3">항목</th><th colspan="5">구분 (체감온도 기준)</th><th rowspan="2" width="20%">조치사항</th><th rowspan="2" width="10%">비고</th></tr><tr><th width="6%">온도</th><th width="6%">습도</th><th width="7%">체감온도</th><th class="th-normal" width="5%">정상<br><span style="font-size:8px; font-weight:normal;">31℃미만</span></th><th class="th-interest" width="5%">관심<br><span style="font-size:8px; font-weight:normal;">31℃이상</span></th><th class="th-attention" width="5%">주의<br><span style="font-size:8px; font-weight:normal;">33℃이상</span></th><th class="th-warning" width="5%">경고<br><span style="font-size:8px; font-weight:normal;">35℃이상</span></th><th class="th-danger" width="5%">위험<br><span style="font-size:8px; font-weight:normal;">38℃이상</span></th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  setTimeout(() => { window.print(); const cleanup = () => { printArea.innerHTML = ""; window.removeEventListener("afterprint", cleanup); }; window.addEventListener("afterprint", cleanup); }, 300);
}

function printSelectedChecklists() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-check-print:checked")).map(chk => chk.getAttribute("data-id"));
  if (selectedIds.length === 0) { alert("출력할 자율점검표를 선택해주세요."); return; }
  const records = checklistDb.filter(r => selectedIds.includes(r.id.toString()));
  const printArea = document.getElementById("print-area"); printArea.innerHTML = "";
  records.forEach((r, idx) => {
    const pageDiv = document.createElement("div"); if (idx < records.length - 1) pageDiv.className = "kosha-page-break";
    pageDiv.innerHTML = `<div class="kosha-print-title">폭염안전 5대 기본수칙 자율점검표</div><div style="text-align: right; margin-bottom: 5px; font-size: 12px;">점검일자: ${r.date}</div><table class="kosha-print-table"><thead><tr><th width="20%">구분</th><th width="50%">점검항목</th><th width="10%">적정</th><th width="10%">개선필요</th><th width="10%">해당없음</th></tr></thead><tbody><tr><td rowspan="1" style="font-weight:bold;">1. 물</td><td style="text-align:left;">시원하고 깨끗한 물을 충분히 제공</td><td>${r.water_supply === "적정" ? "O" : ""}</td><td>${r.water_
