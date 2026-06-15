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
  }).catch(() => {
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

  const record = { id: newId, date: dateStr, "점검날짜": dateStr, remarks: remarks, signature: savedSignatureDataUrl };
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
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
