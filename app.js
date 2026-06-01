// =========================================================================
// KOSHA 폭염 예방 모바일 스마트 앱 - 프론트엔드 비즈니스 로직 (app.js)
// =========================================================================

// =========================================================================
// [패치 ①] Google Sheets Web App (GAS) 연동 설정 - 영구 저장/삭제용
// =========================================================================
// ⚠️ GAS 배포 후 발급받은 Web App URL로 반드시 교체할 것
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbyrqnZ6DGMxnj_4QbXffSnT1ANwni2mCiw0mOxf5hmsk4tammjsFa5lIJyV6c2LqDeTJQ/exec";

/**
 * GAS Web App에 POST 요청을 보내는 공용 헬퍼.
 * - Content-Type을 text/plain으로 보내 CORS preflight(OPTIONS) 회피
 * - GAS 측에서 e.postData.contents를 JSON.parse하여 받음
 */
async function gasCall(payload) {
  if (!GAS_API_URL || GAS_API_URL.includes("REPLACE_WITH_YOUR_DEPLOYMENT_ID")) {
    throw new Error("GAS_API_URL이 아직 설정되지 않았습니다. app.js 최상단의 상수를 교체하세요.");
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

// 1. KOSHA 표준 권고 관리조치 규격 정의
const koshaActions = {
  "정상": "• 기본 수칙 준수 (물, 그늘, 휴식)",
  "관심": "• 온열질환 증상 교육\n• 충분한 수분 섭취 권장\n• 적절한 휴식",
  "주의": "• 근로자 건강상태 확인\n• 2시간 이내 20분 이상 휴식",
  "경고": "• 근로자 건강상태 확인\n• 오후 2시~5시 가급적 옥외작업 중지\n• 2시간 이내 20분 이상 휴식",
  "위험": "• 근로자 건강상태 확인\n• 2시간 이내 20분 이상 휴식\n• 필요시 작업 중단"
};

// 모의 서명용 더미 DataURL (투명 배경의 빈 서명 대체)
const dummySignature = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='40'><text x='10' y='25' font-family='sans-serif' font-size='12' fill='gray'>보건서명 완료</text></svg>";

// 2. 데이터베이스 (Google Sheets에서 비동기 로드 — DOMContentLoaded 시점에 loadFromSheets()로 채워짐)
let tempDb = [];
let checklistDb = [];
let tbmDb = [];  // [TBM 패치] TBM 자가진단 기록

// [TBM 패치] TBM 자가진단 9개 항목 — 사용자가 Google Sheets에 정의한 그대로
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

// 이메일 수신 데이터베이스
let emailDb = [];

// 3. 상태 관리 변수
let activeSlot = "AM"; // AM = 오전 10시, PM = 오후 2시
let selectedLocation = "시설 관리팀 작업실";
let currentTemp = 32.0;
let currentHumidity = 55;
let activeRemarks = "";
let activeInspector = "보건관리자";

// 전자 서명 그리기 상태
let canvas, ctx;
let drawing = false;
let lastX = 0, lastY = 0;
let savedSignatureDataUrl = "";
let signContext = "temp";  // [신규] 서명 컨텍스트: "temp" | "tbm" | "checklist"

// =========================================================================
// [초기 구동 리스너 및 렌더러 바인딩]
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  document.getElementById("m-input-record-date").value = dateStr;
  document.getElementById("m-input-checklist-date").value = dateStr;
  // 체감기록 시간 자동 입력 (현재 실제 시각)
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const timeEl = document.getElementById("m-input-record-time");
  if (timeEl) timeEl.value = hh + ':' + mi;
  // [TBM 패치] TBM 날짜 초기값 + 9개 항목 동적 생성
  const tbmDateEl = document.getElementById("m-input-tbm-date");
  if (tbmDateEl) tbmDateEl.value = dateStr;
  initTbmScreen();

  initClock();
  initQRGenerator();
  initNavigation();
  initSubTabs();
  initSliders();
  initChecklistToggles();
  initSignaturePad();
  
  // 데이터 렌더링 — [패치 ③] Google Sheets에서 비동기 로드
  loadFromSheets().then(() => {
    renderArchive();
    updateMissingRecordsWidget();
    // [PC 대시보드 패치] 대시보드 초기 렌더
    if (typeof renderDashboard === "function") {
      renderDashboard();
      setDashboardSyncStatus(true);
    }
  }).catch(() => {
    if (typeof setDashboardSyncStatus === "function") setDashboardSyncStatus(false);
  });

  // [PC 대시보드 패치] 시계 1초 갱신 (모바일에서는 desktop-dashboard가 숨김이므로 무해)
  if (typeof startDashboardClock === "function") {
    startDashboardClock();
  }
  updateMissingRecordsWidget();

  // 이벤트 트리거 바인딩
  document.getElementById("btn-open-sign-modal").addEventListener("click", () => {
    signContext = "temp";  // [신규] 체감기록 컨텍스트
    openSignModal();
  });
  document.getElementById("btn-close-sign").addEventListener("click", () => document.getElementById("sign-pad-modal").classList.remove("active"));
  document.getElementById("btn-close-viewer").addEventListener("click", () => document.getElementById("checklist-viewer-modal").classList.remove("active"));
  
  document.getElementById("btn-final-submit").addEventListener("click", submitRecordFinal);
  document.getElementById("btn-submit-checklist").addEventListener("click", () => {
    signContext = "checklist";  // [신규] 자율점검 컨텍스트
    openSignModal();
  });
  
  // 보관소 검색 이벤트 바인딩
  document.getElementById("search-temp-date-start").addEventListener("change", renderArchive);
  document.getElementById("search-temp-date-end").addEventListener("change", renderArchive);
  document.getElementById("search-temp-loc").addEventListener("change", renderArchive);
  
  document.getElementById("search-check-date-start").addEventListener("change", renderArchive);
  document.getElementById("search-check-date-end").addEventListener("change", renderArchive);
  
  // 전체 선택 및 일괄 인쇄 버튼 바인딩
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

// 시간 갱신
function initClock() {
  const clockEl = document.getElementById("phone-time");
  setInterval(() => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    clockEl.innerText = `${hh}:${min}`;
  }, 1000);
}

// =========================================================================
// [QR 코드 생성기 (KOSHA 모바일 간편 접속 표준)]
// =========================================================================
function initQRGenerator() {
  const qrDisplay = document.getElementById("qr-code-display");
  const liveUrlText = document.getElementById("live-url-text");
  
  // 현재 접속중인 로컬 도메인 탐색 (외부 스마트폰에서 테스트 시 기기 IP가 자동 잡힙니다)
  const currentUrl = window.location.href;
  liveUrlText.innerText = currentUrl;
  
  // 외부 고해상도 QR API를 사용해 동적으로 생성
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(currentUrl)}&color=0f172a`;
  
  qrDisplay.innerHTML = `<img src="${qrApiUrl}" alt="로컬 접속 QR 코드" title="스마트폰으로 스캔하세요">`;
}

// =========================================================================
// [모바일 네비게이션 탭 브라우징 체계]
// =========================================================================
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
      
      // 보관소 탭으로 왔을 경우 리스트 리렌더링
      if (targetScreen === "screen-archive") {
        renderArchive();
        updateMissingRecordsWidget();
      }
      // [수정] TBM 화면 진입 시 9개 항목 비어있으면 재렌더링 (캐시/타이밍 방어)
      if (targetScreen === "screen-tbm") {
        const tbmBox = document.getElementById("tbm-items-container");
        if (tbmBox && tbmBox.children.length === 0 && typeof initTbmScreen === "function") {
          initTbmScreen();
        }
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
      const targetPane = btn.getAttribute("data-sub");
      document.getElementById(targetPane).classList.add("active");
    });
  });
}

// =========================================================================
// [입력 슬라이더 수식 및 오전/오후 세션 관리]
// =========================================================================
function setSlot(slot) {
  activeSlot = slot;
  const amBtn = document.getElementById("btn-slot-am");
  const pmBtn = document.getElementById("btn-slot-pm");

  if (amBtn && pmBtn) {
    if (slot === "AM") {
      amBtn.classList.add("active");
      pmBtn.classList.remove("active");
    } else {
      pmBtn.classList.add("active");
      amBtn.classList.remove("active");
    }
  }
}

function initSliders() {
  const tSlider = document.getElementById("m-input-temp");
  const hSlider = document.getElementById("m-input-humidity");
  const tVal = document.getElementById("m-val-temp");
  const hVal = document.getElementById("m-val-humidity");

  tSlider.addEventListener("input", (e) => {
    currentTemp = parseFloat(e.target.value);
    tVal.value = currentTemp.toFixed(1);
    calculatePerceivedMobile();
  });

  tVal.addEventListener("input", (e) => {
    let val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      currentTemp = val;
      tSlider.value = val;
      calculatePerceivedMobile();
    }
  });

  hSlider.addEventListener("input", (e) => {
    currentHumidity = parseInt(e.target.value);
    hVal.value = currentHumidity;
    calculatePerceivedMobile();
  });

  hVal.addEventListener("input", (e) => {
    let val = parseInt(e.target.value);
    if (!isNaN(val)) {
      currentHumidity = val;
      hSlider.value = val;
      calculatePerceivedMobile();
    }
  });

  calculatePerceivedMobile();
}

// 실시간 기상청 수식 계산
function calculatePerceivedMobile() {
  const perceived = Math.round((currentTemp + 0.14 * (currentHumidity - 50)) * 10) / 10;
  
  let stage = "정상";
  let color = "var(--color-normal)";
  let badgeClass = "badge-normal";

  if (perceived >= 38) { stage = "위험"; color = "var(--color-danger)"; badgeClass = "badge-danger"; }
  else if (perceived >= 35) { stage = "경고"; color = "var(--color-warning)"; badgeClass = "badge-warning"; }
  else if (perceived >= 33) { stage = "주의"; color = "var(--color-attention)"; badgeClass = "badge-attention"; }
  else if (perceived >= 31) { stage = "관심"; color = "var(--color-interest)"; badgeClass = "badge-interest"; }

  // UI 대입
  const calcP = document.getElementById("m-calc-perceived");
  calcP.innerText = `${perceived.toFixed(1)} ℃`;
  calcP.style.color = color;
  
  const calcS = document.getElementById("m-calc-stage");
  calcS.innerText = stage;
  calcS.className = `badge ${badgeClass}`;

  const calcA = document.getElementById("m-calc-action");
  calcA.innerHTML = koshaActions[stage].replace(/\n/g, "<br>");
  
  const previewBox = document.getElementById("m-preview-box");
  previewBox.style.borderColor = color;
  previewBox.style.backgroundColor = `rgba(${color === 'var(--color-normal)' ? '59,130,246' : color === 'var(--color-interest)' ? '6,182,212' : color === 'var(--color-attention)' ? '234,179,8' : color === 'var(--color-warning)' ? '249,115,22' : '239,68,68'}, 0.04)`;
}

// =========================================================================
// [주간 자율점검 Y/N 토글 제어]
// =========================================================================
function initChecklistToggles() {
  const rows = document.querySelectorAll(".checklist-items-group .chk-item-row");
  
  rows.forEach(row => {
    const buttons = row.querySelectorAll(".yn-btn");
    buttons.forEach(btn => {
      btn.addEventListener("click", () => {
        buttons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        const value = btn.getAttribute("data-val");
        if (value === "개선필요") {
          row.classList.add("failure-highlight");
        } else {
          row.classList.remove("failure-highlight");
        }
      });
    });
  });
}

// =========================================================================
// [8. HTML5 CANVAS 터치 전자서명 패드 엔진]
// =========================================================================
function initSignaturePad() {
  canvas = document.getElementById("signature-canvas");
  ctx = canvas.getContext("2d");

  // [모바일 패치] 캔버스 픽셀 버퍼를 실제 표시 크기 × devicePixelRatio로 동적 설정
  // — 기본 300x150 픽셀 버퍼와 CSS 100%x150px 불일치로 인한 흐림/좌표 오차 해결
  resizeSignatureCanvas();
  window.addEventListener("resize", debounce(resizeSignatureCanvas, 150));
  // 모바일 키보드 열림/회전 대응: visualViewport 변화도 감지
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", debounce(resizeSignatureCanvas, 150));
  }
  
  // 브러시 스타일 설정 (resizeSignatureCanvas 내부에서도 재적용됨)
  ctx.strokeStyle = "#0f172a"; // 짙은 네이비
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // PC 마우스 드로잉 바인딩
  canvas.addEventListener("mousedown", (e) => {
    drawing = true;
    [lastX, lastY] = getCoordinates(e);
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!drawing) return;
    draw(e);
  });

  canvas.addEventListener("mouseup", () => drawing = false);
  canvas.addEventListener("mouseleave", () => drawing = false);

  // 모바일 정전식 스마트폰 터치 드로잉 연동 (중요: 바디 스크롤 차단)
  canvas.addEventListener("touchstart", (e) => {
    drawing = true;
    const touch = e.touches[0];
    [lastX, lastY] = getCoordinates(touch);
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchmove", (e) => {
    if (!drawing) return;
    const touch = e.touches[0];
    draw(touch);
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchend", (e) => {
    drawing = false;
    e.preventDefault();
  }, { passive: false });

  // 조작 버튼 연동
  document.getElementById("btn-clear-canvas").addEventListener("click", clearCanvas);
  document.getElementById("btn-save-signature").addEventListener("click", saveSignature);
}

// [모바일 패치] 캔버스를 실제 표시 크기에 맞춰 픽셀 버퍼와 좌표계 동기화
function resizeSignatureCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;  // 보이지 않는 상태(display:none)면 패스
  
  // 기존 그림이 있으면 백업 후 복원
  let backup = null;
  if (canvas.width > 0 && canvas.height > 0) {
    try { backup = canvas.toDataURL(); } catch(_) {}
  }
  
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // 그리기 좌표를 CSS 픽셀 기준으로
  
  // 브러시 스타일 재적용 (canvas.width/height 변경 시 ctx 상태 리셋됨)
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  
  // 백업된 그림 복원
  if (backup) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = backup;
  }
}

// [모바일 패치] resize 이벤트 과다 호출 방지용 디바운스
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 캔버스 좌표 산출 함수
function getCoordinates(event) {
  const rect = canvas.getBoundingClientRect();

  // [모바일 패치] ctx.setTransform(dpr, ...)으로 좌표계가 CSS 픽셀로 정규화돼 있어
  // 화면 좌표(clientX/Y)에서 rect 오프셋만 빼면 됨 (별도 스케일 보정 불필요)
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  return [x, y];
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
  // [수정] 변환 행렬(dpr 스케일) 무시하고 캔버스 픽셀 버퍼 전체를 강제 클리어
  // — 모달이 hidden 상태에서 호출되어도, 다음 서명 시작 시 이전 그림이 남지 않음
  if (!canvas || !ctx) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  // 빈 캔버스의 dataURL을 미리 기록해두면 다음 비교에 활용 가능 (선택)
}

// 서명 저장 및 결과 확인 모달로 연동
function saveSignature() {
  // 캔버스 드로잉 데이터 PNG 파일(DataURL) 변환
  savedSignatureDataUrl = canvas.toDataURL();

  // [신규] TBM/자율점검은 결과 확인 모달 거치지 않고 바로 제출
  if (signContext === "tbm") {
    document.getElementById("sign-pad-modal").classList.remove("active");
    submitTbm();
    return;
  }
  if (signContext === "checklist") {
    document.getElementById("sign-pad-modal").classList.remove("active");
    submitChecklist();
    return;
  }

  // ↓ 기존 체감기록 로직 (결과 확인 모달 표시)
  const perceived = Math.round((currentTemp + 0.14 * (currentHumidity - 50)) * 10) / 10;
  let stage = "정상";
  if (perceived >= 38) stage = "위험";
  else if (perceived >= 35) stage = "경고";
  else if (perceived >= 33) stage = "주의";
  else if (perceived >= 31) stage = "관심";

  document.getElementById("c-loc").innerText = selectedLocation;
  document.getElementById("c-temp").innerText = `${currentTemp.toFixed(1)} ℃`;
  document.getElementById("c-hum").innerText = `${currentHumidity} %`;
  
  const cPerc = document.getElementById("c-perceived");
  cPerc.innerText = `${perceived.toFixed(1)} ℃`;
  
  // 등급별 컬러 매칭
  const colors = { "정상": "var(--color-normal)", "관심": "var(--color-interest)", "주의": "var(--color-attention)", "경고": "var(--color-warning)", "위험": "var(--color-danger)" };
  cPerc.style.color = colors[stage];

  const cStg = document.getElementById("c-stage");
  cStg.innerText = stage;
  const badgeMap = { "정상": "badge-normal", "관심": "badge-interest", "주의": "badge-attention", "경고": "badge-warning", "위험": "badge-danger" };
  cStg.className = `badge ${badgeMap[stage]}`;

  document.getElementById("c-action-text").innerHTML = koshaActions[stage].replace(/\n/g, "<br>");
  document.getElementById("capture-sign-img").src = savedSignatureDataUrl;

  // 서명모달 닫고 결과 확인 팝업 활성화
  document.getElementById("sign-pad-modal").classList.remove("active");
  document.getElementById("result-confirm-modal").classList.add("active");
}

function openSignModal() {
  // [수정] 이전 서명 데이터 완전 초기화
  savedSignatureDataUrl = "";

  // 모달 활성화
  document.getElementById("sign-pad-modal").classList.add("active");

  // [수정] CSS transition 완료 + 캔버스 표시 보장 후 강제 리사이즈 (canvas.width 할당 = 자동 클리어)
  setTimeout(() => {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width  = rect.width * dpr;   // ← canvas.width 할당 자체가 픽셀 버퍼 자동 클리어
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }
    clearCanvas();  // 추가 안전망: 변환 행렬 무시 강제 클리어
  }, 150);  // 30ms → 150ms로 늘림 (CSS transition + 레이아웃 안정화 대기)
}

// =========================================================================
// [9. 최종 제출 및 데이터 동기화 에뮬레이션]
// =========================================================================
function submitRecordFinal() {
  const perceived = Math.round((currentTemp + 0.14 * (currentHumidity - 50)) * 10) / 10;
  
  let stage = "정상";
  if (perceived >= 38) stage = "위험";
  else if (perceived >= 35) stage = "경고";
  else if (perceived >= 33) stage = "주의";
  else if (perceived >= 31) stage = "관심";

  const newId = `TMP-${100 + tempDb.length + 1}`;
  
  // 선택된 날짜 가져오기 (없으면 당일)
  const now = new Date();
  let dateStr = document.getElementById("m-input-record-date").value;
  if (!dateStr) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    dateStr = `${y}-${m}-${d}`;
  }
  // 사용자가 입력한 시간 필드 사용 (없으면 현재 시각으로 폴백)
  let timeStr = document.getElementById("m-input-record-time")?.value || "";
  if (!timeStr) {
    timeStr = now.toTimeString().split(' ')[0].substring(0, 5);
  }
  // 시간 기준으로 AM/PM 자동 판별
  const timeHour = parseInt(timeStr.split(':')[0], 10);
  const derivedSlot = timeHour < 12 ? "AM" : "PM";

  const record = {
    id: newId,
    date: dateStr,
    slot: derivedSlot,
    time: timeStr,
    inspector: activeInspector,
    location: selectedLocation,
    temp: currentTemp,
    humidity: currentHumidity,
    perceived: perceived,
    stage: stage,
    action: koshaActions[stage],
    signature: savedSignatureDataUrl,
    remarks: activeRemarks || "모바일에서 작성 완료 (이상 없음)"
  };

  // 구글 시트 데이터 전송 에뮬레이터 로딩 루프
  const submitBtn = document.getElementById("btn-final-submit");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sheets 데이터 적재 중...`;

  setTimeout(async () => {
    // [패치 ④-A] Google Sheets 영구 저장
    try {
      const res = await gasCall({ action: "create", target: "temp", record: record });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
      if (res.id) record.id = res.id;  // 서버가 발급한 ID로 갱신
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> 구글 시트 전송 & 관리자 경고 메일 발송`;
      alert("⚠️ 구글 시트 저장 실패\n" + err.message + "\n\n네트워크나 GAS Web App URL을 확인해주세요.");
      return;
    }

    tempDb.unshift(record);
    
    // 모달 닫기 및 폼 초기화
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> 구글 시트 전송 & 관리자 경고 메일 발송`;
    document.getElementById("result-confirm-modal").classList.remove("active");
    document.getElementById("m-input-remarks").value = "";
    activeRemarks = "";

    // 보관소 탭으로 활성화 이동
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    document.querySelectorAll(".app-screen").forEach(s => s.classList.remove("active"));
    
    document.querySelector(".nav-item[data-screen='screen-archive']").classList.add("active");
    document.getElementById("screen-archive").classList.add("active");

    // 보관소 갱신
    renderArchive();
    updateMissingRecordsWidget();

    // GAS 백그라운드 경고 메일 전송
    triggerMockGas(record);

    alert(`[기록 저장 완료] ${selectedLocation}의 오전/오후 체감온도 기록지가 성공적으로 저장되었습니다.`);
  }, 1000);
}

// 주간 자율점검표 전송
function submitChecklist() {
  const remarks = document.getElementById("chk-input-remarks").value || "보완사항 없음. 준수 완료.";
  
  const water_supply = document.querySelector(".chk-item-row[data-key='water-supply'] .yn-btn.active").getAttribute("data-val");
  const shade_cooling = document.querySelector(".chk-item-row[data-key='shade-cooling'] .yn-btn.active").getAttribute("data-val");
  const shade_minimize = document.querySelector(".chk-item-row[data-key='shade-minimize'] .yn-btn.active").getAttribute("data-val");
  const rest_facility = document.querySelector(".chk-item-row[data-key='rest-facility'] .yn-btn.active").getAttribute("data-val");
  const rest_31 = document.querySelector(".chk-item-row[data-key='rest-31'] .yn-btn.active").getAttribute("data-val");
  const rest_33 = document.querySelector(".chk-item-row[data-key='rest-33'] .yn-btn.active").getAttribute("data-val");
  const cooling_gear = document.querySelector(".chk-item-row[data-key='cooling-gear'] .yn-btn.active").getAttribute("data-val");
  const emergency_unconscious = document.querySelector(".chk-item-row[data-key='emergency-unconscious'] .yn-btn.active").getAttribute("data-val");
  const emergency_conscious = document.querySelector(".chk-item-row[data-key='emergency-conscious'] .yn-btn.active").getAttribute("data-val");
  const other_thermometer = document.querySelector(".chk-item-row[data-key='other-thermometer'] .yn-btn.active").getAttribute("data-val");
  const other_education = document.querySelector(".chk-item-row[data-key='other-education'] .yn-btn.active").getAttribute("data-val");
  const other_record = document.querySelector(".chk-item-row[data-key='other-record'] .yn-btn.active").getAttribute("data-val");
  const other_sensitive = document.querySelector(".chk-item-row[data-key='other-sensitive'] .yn-btn.active").getAttribute("data-val");

  const newId = `CHK-${100 + checklistDb.length + 1}`;
  const now = new Date();
  let dateStr = document.getElementById("m-input-checklist-date").value;
  if (!dateStr) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    dateStr = `${y}-${m}-${d}`;
  }

  const record = {
    id: newId,
    date: dateStr,
    water_supply,
    shade_cooling,
    shade_minimize,
    rest_facility,
    rest_31,
    rest_33,
    cooling_gear,
    emergency_unconscious,
    emergency_conscious,
    other_thermometer,
    other_education,
    other_record,
    other_sensitive,
    remarks: remarks,
    signature: savedSignatureDataUrl  // [신규] 서명
  };

  const submitBtn = document.getElementById("btn-submit-checklist");
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 자율점검 DB 등록 중...`;

  setTimeout(async () => {
    // [패치 ④-B] Google Sheets 영구 저장
    try {
      const res = await gasCall({ action: "create", target: "checklist", record: record });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
      if (res.id) record.id = res.id;
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-pen-nib"></i> 기록 및 전자 서명하기`;
      alert("⚠️ 구글 시트 저장 실패\n" + err.message + "\n\n네트워크나 GAS Web App URL을 확인해주세요.");
      return;
    }

    checklistDb.unshift(record);
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-pen-nib"></i> 기록 및 전자 서명하기`;

    // 폼 초기화 및 적정 표시 리셋
    document.getElementById("chk-input-remarks").value = "";
    document.querySelectorAll(".checklist-items-group .chk-item-row").forEach(row => {
      row.classList.remove("failure-highlight");
      row.querySelectorAll(".yn-btn").forEach(b => b.classList.remove("active"));
      row.querySelector(".yn-btn[data-val='적정']").classList.add("active");
    });

    // 보관소 탭으로 화면 강제 스위칭
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    document.querySelectorAll(".app-screen").forEach(s => s.classList.remove("active"));
    
    document.querySelector(".nav-item[data-screen='screen-archive']").classList.add("active");
    document.getElementById("screen-archive").classList.add("active");

    // 자율점검 탭(서브) 포커싱
    document.querySelectorAll(".archive-sub-tabs .sub-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".archive-sub-pane").forEach(p => p.classList.remove("active"));
    document.querySelector(".sub-tab-btn[data-sub='sub-check']").classList.add("active");
    document.getElementById("sub-check").classList.add("active");

    renderArchive();

    alert(`[주간 점검 완료] ${dateStr} 자율점검표가 DB에 등록되었습니다.`);
  }, 1000);
}

// =========================================================================
// [10. "기록지 보관소" 및 "누락된 기록지" 스캔 로직]
// =========================================================================
function updateMissingRecordsWidget() {
  // [수정 v3] 미제출 누락 경보 기능 삭제됨 — 호출처 보존을 위해 빈 함수로 유지
  return;
}

// =========================================================================
// [패치 ③] Google Sheets에서 데이터 로드 (페이지 진입 시 1회)
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

  console.log("[로드:체감]", tempRes);
  console.log("[로드:자율점검]", chkRes);
  console.log("[로드:TBM]", tbmRes);

  const pick = (r, key) => {
    if (r[key] !== undefined) return r[key];
    for (const k of Object.keys(r)) {
      if (String(k).trim() === key) return r[k];
    }
    return undefined;
  };

  // ── 체감온도 매핑 ──
  if (tempRes && tempRes.ok && Array.isArray(tempRes.records)) {
    tempDb = tempRes.records
      .filter(r => pick(r, "ID"))
      .map(r => ({
        id: String(pick(r, "ID")),
        date: _formatDateOnly(pick(r, "기록일시")),
        slot: pick(r, "시간슬롯") || "AM",
        // ✅ [수정 완료] 구글 시트의 자동 생성 '기록일시' 대신 사용자가 입력한 '시간'을 최우선으로 매핑합니다.
        time: pick(r, "측정시간") || pick(r, "시간") || pick(r, "time") || _formatTimeOnly(pick(r, "기록일시")),
        inspector: pick(r, "측정자") || "보건관리자",
        location: pick(r, "측정 장소") || "",
        temp: parseFloat(pick(r, "기온")) || 0,
        humidity: parseFloat(pick(r, "습도")) || 0,
        perceived: parseFloat(pick(r, "체감온도")) || 0,
        stage: pick(r, "폭염 단계") || "정상",
        action: koshaActions[pick(r, "폭염 단계")] || koshaActions["정상"],
        signature: pick(r, "서명") || dummySignature,
        remarks: pick(r, "특이사항") || ""
      }))
      .sort((a, b) => (b.date + b.slot).localeCompare(a.date + a.slot));
    console.log(`[로드:체감] 매핑 후 ${tempDb.length}건`);
  } else {
    console.warn("[로드:체감] 응답 비정상 또는 빈 결과");
  }

  // ── 자율점검 매핑 ──
  if (chkRes && chkRes.ok && Array.isArray(chkRes.records)) {
    checklistDb = chkRes.records
      .filter(r => pick(r, "ID"))
      .map(r => ({
        id: String(pick(r, "ID")),
        date: _formatDateOnly(pick(r, "점검일시")),
        water_supply: pick(r, "물_식수제공") || "적정",
        shade_cooling: pick(r, "그늘_냉방그늘막") || "적정",
        shade_minimize: pick(r, "그늘_노출최소화") || "적정",
        rest_facility: pick(r, "휴식_휴게시설") || "적정",
        rest_31: pick(r, "휴식_31도휴식") || "적정",
        rest_33: pick(r, "휴식_33도휴식") || "적정",
        cooling_gear: pick(r, "보냉장구_개인지급") || "적정",
        emergency_unconscious: pick(r, "응급조치_무의식신고") || "적정",
        emergency_conscious: pick(r, "응급조치_의식응급조치") || "적정",
        other_thermometer: pick(r, "그외_온습도계") || "적정",
        other_education: pick(r, "그외_안전교육") || "적정",
        other_record: pick(r, "그외_기록보관") || "적정",
        other_sensitive: pick(r, "그외_민감군계획") || "적정",
        remarks: pick(r, "특이사항") || "",
        signature: pick(r, "서명") || ""
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    console.log(`[로드:자율점검] 매핑 후 ${checklistDb.length}건`);
  } else {
    console.warn("[로드:자율점검] 응답 비정상 또는 빈 결과:", chkSettled);
  }

  // ── TBM 매핑 ──
  if (tbmRes && tbmRes.ok && Array.isArray(tbmRes.records)) {
    tbmDb = tbmRes.records
      .filter(r => pick(r, "ID"))
      .map(r => ({
        id: String(pick(r, "ID")),
        date: _formatDateOnly(pick(r, "작성일시")),
        inspector: pick(r, "작성자") || "보건관리자",
        q1: pick(r, "Q1_컨디션")      || "아니오",
        q2: pick(r, "Q2_건강상태")    || "아니오",
        q3: pick(r, "Q3_개인요인")    || "아니오",
        q4: pick(r, "Q4_현장적응")    || "아니오",
        q5: pick(r, "Q5_외관관찰")    || "아니오",
        q6: pick(r, "Q6_행동관찰")    || "아니오",
        q7: pick(r, "Q7_특별관리")    || "아니오",
        q8: pick(r, "Q8_물섭취서약")  || "예",
        q9: pick(r, "Q9_동료관찰서약")|| "예",
        remarks: pick(r, "특이사항") || "",
        signature: pick(r, "서명") || ""
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    console.log(`[로드:TBM] 매핑 후 ${tbmDb.length}건`);
  } else {
    console.warn("[로드:TBM] 응답 비정상 또는 빈 결과:", tbmSettled);
  }

  if (!tempRes && !chkRes && !tbmRes) {
    alert("⚠️ Google Sheets 데이터 로드 실패\n네트워크 또는 GAS Web App URL을 확인해주세요.");
  }
}

function _formatDateOnly(val) {
  if (!val) return "";
  const s = String(val);
  // 이미 YYYY-MM-DD 형식이면 그대로
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  const d = new Date(val);
  if (isNaN(d.getTime())) return s.substring(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _formatTimeOnly(val) {
  if (!val) return "00:00";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "00:00";
  const h = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${mn}`;
}

// 보관소 리스트 렌더링 (체감 기록 목록 부분만 덮어쓰기)
function renderArchive() {
  // 1. 체감 기록 목록 렌더링
  const tempContainer = document.getElementById("archive-temp-list");
  tempContainer.innerHTML = "";

  const tempStart = document.getElementById("search-temp-date-start")?.value || "";
  const tempEnd = document.getElementById("search-temp-date-end")?.value || "";
  const tempLoc = document.getElementById("search-temp-loc")?.value || "전체";

  const filteredTempDb = tempDb.filter(row => {
    let matchDate = true;
    let matchLoc = true;
    
    if (tempStart && row.date < tempStart) matchDate = false;
    if (tempEnd && row.date > tempEnd) matchDate = false;
    if (tempLoc !== "전체" && row.location !== tempLoc) matchLoc = false;
    
    return matchDate && matchLoc;
  });

  filteredTempDb.forEach(row => {
    const card = document.createElement("div");
    card.className = "temp-record-item-card";
    
    const slotKor = row.slot === "AM" ? "오전 10시" : "오후 2시";
    const dateFormatted = row.date.substring(5).replace('-', '.');
    // ✅ 수정됨: 고유한 row.id를 사용합니다.
    const tempId = String(row.id); 
    
    card.innerHTML = `
      <div class="t-rec-top">
        <span class="tr-dt" style="display:flex; align-items:center;">
          <input type="checkbox" class="chk-item-print chk-temp-print" data-id="${tempId}">
          <i class="fa-regular fa-calendar-check" style="margin-left: 5px; margin-right: 5px;"></i> ${dateFormatted} (${slotKor})
        </span>
        <span class="tr-time">${row.time} 전송</span>
      </div>
      <div class="t-rec-body">
        <span class="tr-vals">${row.location}</span>
        <span class="badge ${row.stage === '정상' ? 'badge-normal' : row.stage === '관심' ? 'badge-interest' : row.stage === '주의' ? 'badge-attention' : row.stage === '경고' ? 'badge-warning' : 'badge-danger'}">${row.stage}</span>
      </div>
      <div class="t-rec-footer">
        <div class="t-rec-sign-thumb">
          <img src="${row.signature}" alt="서명">
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
          <span style="font-size: 9px; color:var(--text-muted); font-weight: bold;">체감온도: ${row.perceived.toFixed(1)}℃</span>
          <button class="m-btn m-btn-blue btn-print-temp" style="margin: 0; padding: 4px 8px; font-size: 10px;" data-id="${tempId}"><i class="fa-solid fa-file-pdf"></i> 개별 출력</button>
        </div>
      </div>
    `;
    
    tempContainer.appendChild(card);
  });

  // ... (이후 자율점검 목록 렌더링 코드는 기존과 동일하게 유지하시면 됩니다.)

  // 2. 주간 자율점검 목록 렌더링 (날짜 클릭 상세 보기 연동)
  const checkContainer = document.getElementById("archive-check-list");
  checkContainer.innerHTML = "";

  const checkStart = document.getElementById("search-check-date-start")?.value || "";
  const checkEnd = document.getElementById("search-check-date-end")?.value || "";

  const filteredChecklistDb = checklistDb.filter(row => {
    let matchDate = true;
    if (checkStart && row.date < checkStart) matchDate = false;
    if (checkEnd && row.date > checkEnd) matchDate = false;
    return matchDate;
  });

  // 자율점검 13개 항목 (상태 판정용)
  const CHECK_KEYS = [
    "water_supply","shade_cooling","shade_minimize","rest_facility","rest_31","rest_33",
    "cooling_gear","emergency_unconscious","emergency_conscious","other_thermometer",
    "other_education","other_record","other_sensitive"
  ];

  filteredChecklistDb.forEach(row => {
    // 상태 판정: 13개 중 "개선필요" 있으면 주의, 아니면 정상
    const flagCount = CHECK_KEYS.filter(k => row[k] === "개선필요").length;
    const overall = flagCount >= 1 ? '주의' : '정상';
    const badgeCls = flagCount >= 1 ? 'badge-attention' : 'badge-normal';

    const rowDiv = document.createElement("div");
    rowDiv.className = "archive-card-compact";

    rowDiv.innerHTML = `
      <div class="acc-left">
        <input type="checkbox" class="chk-item-print chk-check-print" data-id="${row.id}">
        <span class="acc-date">${row.date}</span>
        <span class="card-slot-chip">자율점검</span>
      </div>
      <div class="acc-mid">
        <img class="acc-sign" src="${row.signature || dummySignature}" alt="서명">
      </div>
      <div class="acc-right">
        <span class="badge ${badgeCls}">${overall}</span>
        <button class="acc-pdf-btn btn-print-check" data-id="${row.id}">
          <i class="fa-solid fa-file-pdf"></i>
        </button>
      </div>
    `;

    // 🌟 카드 클릭 시 상세 모달 오픈 (기존 동작 유지)
    // 단, 체크박스/PDF 버튼 클릭 시에는 모달 열리지 않음
    rowDiv.addEventListener("click", (e) => {
      if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return;
      openChecklistViewer(row);
    });

    // 개별 PDF 버튼: 이벤트 전파 차단 + 해당 항목만 출력
    const printBtn = rowDiv.querySelector(".btn-print-check");
    if (printBtn) {
      printBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".chk-check-print").forEach(chk => chk.checked = false);
        const targetChk = rowDiv.querySelector(".chk-check-print");
        if (targetChk) targetChk.checked = true;
        printSelectedChecklists();
      });
    }

    checkContainer.appendChild(rowDiv);
  });

  // 상태 변경 시 전체 체크박스 초기화
  const chkTempAll = document.getElementById("chk-temp-all");
  if(chkTempAll) chkTempAll.checked = false;
  const chkCheckAll = document.getElementById("chk-check-all");
  if(chkCheckAll) chkCheckAll.checked = false;

  // 개별 PDF 출력 버튼 이벤트 (선택한 것만 출력하도록 함)
  document.querySelectorAll(".btn-print-temp").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const tempId = btn.getAttribute("data-id");
      // 기존 기록들의 체크 상태를 임시 무시하고, 클릭한 버튼의 기록 하나만 출력
      document.querySelectorAll(".chk-temp-print").forEach(chk => chk.checked = false);
      const targetChk = document.querySelector(`.chk-temp-print[data-id="${tempId}"]`);
      if(targetChk) targetChk.checked = true;
      printSelectedTempRecords();
    });
  });

  document.querySelectorAll(".btn-print-check").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const cid = btn.getAttribute("data-id");
      document.querySelectorAll(".chk-check-print").forEach(chk => chk.checked = false);
      const targetChk = document.querySelector(`.chk-check-print[data-id="${cid}"]`);
      if(targetChk) targetChk.checked = true;
      printSelectedChecklists();
    });
  });

  // [PC 대시보드 패치] 보관소 갱신될 때마다 대시보드도 동기화 (모바일에선 숨김 상태라 무해)
  // [TBM 패치] TBM 모바일 보관소 리스트 렌더링도 함께
  renderTbmArchiveList();
  if (typeof renderDashboard === "function") renderDashboard();
}

// 점검표 날짜 클릭 상세보기 팝업 엔진
function openChecklistViewer(row) {
  document.getElementById("view-date").innerText = row.date;
  document.getElementById("view-remarks").innerText = row.remarks;

  const itemsContainer = document.getElementById("viewer-check-items");
  itemsContainer.innerHTML = "";

  const checklistMapping = [
    { label: "1-1. 시원하고 깨끗한 물을 충분히 제공", value: row.water_supply },
    { label: "2-1. 실내·옥외작업 시 냉방·통풍장치 및 그늘막 설치", value: row.shade_cooling },
    { label: "2-2. 폭염 집중 시간대 노출 최소화", value: row.shade_minimize },
    { label: "3-1. 작업장소 근처 휴게시설 설치 및 물품 비치", value: row.rest_facility },
    { label: "3-2. 체감온도 31도 이상 폭염작업 시 적절한 휴식", value: row.rest_31 },
    { label: "3-3. 체감온도 33도 이상 폭염작업 시 2시간 이내 20분 이상 휴식", value: row.rest_33 },
    { label: "4-1. 개인 보냉장구 지급", value: row.cooling_gear },
    { label: "5-1. 온열질환 의심자 무의식 시 즉시 119 신고", value: row.emergency_unconscious },
    { label: "5-2. 의식 있을 시 응급조치 후 증상 미개선 시 119 신고", value: row.emergency_conscious },
    { label: "6-1. 작업장소의 체감온도 온습도계 비치", value: row.other_thermometer },
    { label: "6-2. 온열질환 증상 및 예방교육 실시", value: row.other_education },
    { label: "6-3. 체감온도 측정 및 조치사항 기록·보관", value: row.other_record },
    { label: "6-4. 온열질환 민감군 관리계획 수립", value: row.other_sensitive }
  ];

  checklistMapping.forEach(item => {
    const rowItem = document.createElement("div");
    rowItem.className = "view-item-badge-row";
    
    let badgeClass = "val-적정";
    if (item.value === "개선필요") badgeClass = "val-개선필요";
    else if (item.value === "해당없음") badgeClass = "val-해당없음";

    rowItem.innerHTML = `
      <span class="itm-lbl">${item.label}</span>
      <span class="itm-val-badge ${badgeClass}">${item.value}</span>
    `;
    itemsContainer.appendChild(rowItem);
  });

  document.getElementById("checklist-viewer-modal").classList.add("active");
}

// =========================================================================
// [11. GAS & Mail 전송 모의 에뮬레이션 백그라운드]
// =========================================================================
function triggerMockGas(record) {
  if (record.perceived >= 33) {
    const email = {
      sender: "KOSHA 폭염경보 스마트봇",
      sub: `🚨 [폭염경보 - ${record.stage}] ${record.location} 체감온도 ${record.perceived}℃ 초과 감지! 즉각 대피 및 휴식 유도`
    };
    emailDb.push(email);
    console.log(`[GAS Alert Mail] Sent successfully to safety manager. Sub: ${email.sub}`);
  }
}

// =========================================================================
// [12. 인쇄 (PDF) 기능 - 일괄 다중 출력 렌더링]
// =========================================================================
// =========================================================================
// [12. 인쇄 (PDF) 기능 - 일괄 다중 출력 렌더링]
// =========================================================================
function printSelectedTempRecords() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-temp-print:checked")).map(chk => chk.getAttribute("data-id"));
  if (selectedIds.length === 0) {
    alert("출력할 체감기록을 선택해주세요.");
    return;
  }
  
  // ✅ [수정 완료] 고유 ID로 정확히 매칭하고, 날짜와 시간을 결합해 과거순(오름차순)으로 정렬합니다.
  const records = tempDb.filter(r => selectedIds.includes(String(r.id)))
                        .sort((a, b) => {
                            const dtA = `${a.date} ${a.time}`;
                            const dtB = `${b.date} ${b.time}`;
                            return dtA.localeCompare(dtB);
                        });

  const printArea = document.getElementById("print-area");
  
  // 월(Month) 추출 (단일 월인지, 다중 월인지 판단)
  const uniqueMonths = [...new Set(records.map(r => r.date.substring(5,7)))];
  const monthStr = uniqueMonths.length === 1 ? uniqueMonths[0] : "다중 선택";

  // 장소 추출 (단일 장소인지, 여러 장소인지 판단)
  const uniqueLocs = [...new Set(records.map(r => r.location))];
  const locStr = uniqueLocs.length === 1 ? uniqueLocs[0] : "기간/부서별 전체 장소";

  let rowsHtml = '';
  records.forEach(r => {
    const isNormal = r.perceived < 31;
    const isInterest = r.perceived >= 31 && r.perceived < 33;
    const isAttention = r.perceived >= 33 && r.perceived < 35;
    const isWarning = r.perceived >= 35 && r.perceived < 38;
    const isDanger = r.perceived >= 38;

    rowsHtml += `
      <tr>
        <td>${r.date.substring(5).replace('-', '.')}</td>
        <td>${r.time}</td>
        <td style="font-size:9px;">${r.location || ''}</td>
        <td>${r.temp.toFixed(1)}</td>
        <td>${r.humidity}</td>
        <td>${r.perceived.toFixed(2)}</td>
        <td>${isNormal ? '√' : ''}</td>
        <td>${isInterest ? '√' : ''}</td>
        <td>${isAttention ? '√' : ''}</td>
        <td>${isWarning ? '√' : ''}</td>
        <td>${isDanger ? '√' : ''}</td>
        <td style="text-align: left; font-size: 10px;">${r.action}</td>
        <td style="font-size: 10px;">${r.remarks.includes("모바일") ? "" : r.remarks}</td>
      </tr>
    `;
  });

  // 빈 줄 여유분 15줄 추가 (양식 맞춤)
  const emptyRowsNeeded = Math.max(0, 15 - records.length);
  for(let i=0; i<emptyRowsNeeded; i++) {
    rowsHtml += `
        <tr>
          <td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
        </tr>
    `;
  }

  printArea.innerHTML = "";  // 이전 출력 내용 초기화
  printArea.innerHTML = `
    <div class="kosha-print-title">체감온도 기록지</div>
    <div class="kosha-print-info">
      <div style="text-align: center; font-size: 14px; font-weight: bold; margin-bottom: 10px;">( &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${monthStr} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)월</div>
      ❖ 작성 기준 : ■ 2회/일 (체크시간: 오전 10시 / 오후 2시) &nbsp;&nbsp;&nbsp; □ 작업 전 측정 (단시간 작업시)<br>
      ❖ 측정 장소 : ■ ${locStr} <br>
      ❖ 보관기한: 당해 연도 12월 31일까지
    </div>
    <table class="kosha-print-table">
      <thead>
        <tr>
          <th rowspan="2" width="6%">날짜</th>
          <th rowspan="2" width="6%">시간</th>
          <th rowspan="2" width="12%">측정장소</th>
          <th colspan="3">항목</th>
          <th colspan="5">구분 (체감온도 기준)</th>
          <th rowspan="2" width="20%">조치사항</th>
          <th rowspan="2" width="10%">비고</th>
        </tr>
        <tr>
          <th width="6%">온도</th>
          <th width="6%">습도</th>
          <th width="7%">체감온도</th>
          <th class="th-normal" width="5%">정상<br><span style="font-size:8px; font-weight:normal;">31℃미만</span></th>
          <th class="th-interest" width="5%">관심<br><span style="font-size:8px; font-weight:normal;">31℃이상</span></th>
          <th class="th-attention" width="5%">주의<br><span style="font-size:8px; font-weight:normal;">33℃이상</span></th>
          <th class="th-warning" width="5%">경고<br><span style="font-size:8px; font-weight:normal;">35℃이상</span></th>
          <th class="th-danger" width="5%">위험<br><span style="font-size:8px; font-weight:normal;">38℃이상</span></th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  // DOM 렌더링 완료 후 print (즉시 호출 시 빈 출력 방지)
  setTimeout(() => {
    window.print();
    // 출력 완료 후 print-area 초기화
    const cleanup = () => { printArea.innerHTML = ""; window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
  }, 300);
}

function printSelectedChecklists() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-check-print:checked")).map(chk => chk.getAttribute("data-id"));
  if (selectedIds.length === 0) {
    alert("출력할 자율점검표를 선택해주세요.");
    return;
  }

  const records = checklistDb.filter(r => selectedIds.includes(r.id.toString()));
  const printArea = document.getElementById("print-area");
  printArea.innerHTML = ""; // 기존 내용 초기화

  records.forEach((r, idx) => {
    const pageDiv = document.createElement("div");
    // 마지막 페이지가 아니면 페이지 나누기(page-break-after) CSS 클래스 부여
    if (idx < records.length - 1) {
      pageDiv.className = "kosha-page-break";
    }
    
    pageDiv.innerHTML = `
      <div class="kosha-print-title">폭염안전 5대 기본수칙 자율점검표</div>
      <div style="text-align: right; margin-bottom: 5px; font-size: 12px;">점검일자: ${r.date}</div>
      <table class="kosha-print-table">
        <thead>
          <tr>
            <th width="20%">구분</th>
            <th width="50%">점검항목</th>
            <th width="10%">적정</th>
            <th width="10%">개선필요</th>
            <th width="10%">해당없음</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td rowspan="1" style="font-weight:bold;">1. 물</td>
            <td style="text-align:left;">시원하고 깨끗한 물을 충분히 제공</td>
            <td>${r.water_supply === "적정" ? "O" : ""}</td>
            <td>${r.water_supply === "개선필요" ? "O" : ""}</td>
            <td>${r.water_supply === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td rowspan="2" style="font-weight:bold;">2. 바람·그늘</td>
            <td style="text-align:left;">실내·옥외작업 시 냉방·통풍장치 및 그늘막 설치</td>
            <td>${r.shade_cooling === "적정" ? "O" : ""}</td>
            <td>${r.shade_cooling === "개선필요" ? "O" : ""}</td>
            <td>${r.shade_cooling === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td style="text-align:left;">폭염 집중 시간대 노출 최소화</td>
            <td>${r.shade_minimize === "적정" ? "O" : ""}</td>
            <td>${r.shade_minimize === "개선필요" ? "O" : ""}</td>
            <td>${r.shade_minimize === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td rowspan="3" style="font-weight:bold;">3. 휴식</td>
            <td style="text-align:left;">작업장소 근처 휴게시설 설치 및 물품 비치</td>
            <td>${r.rest_facility === "적정" ? "O" : ""}</td>
            <td>${r.rest_facility === "개선필요" ? "O" : ""}</td>
            <td>${r.rest_facility === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td style="text-align:left;">체감온도 31도 이상 폭염작업 시 적절한 휴식</td>
            <td>${r.rest_31 === "적정" ? "O" : ""}</td>
            <td>${r.rest_31 === "개선필요" ? "O" : ""}</td>
            <td>${r.rest_31 === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td style="text-align:left;">체감온도 33도 이상 폭염작업 시 2시간 이내 20분 이상 휴식</td>
            <td>${r.rest_33 === "적정" ? "O" : ""}</td>
            <td>${r.rest_33 === "개선필요" ? "O" : ""}</td>
            <td>${r.rest_33 === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td rowspan="1" style="font-weight:bold;">4. 보냉장구</td>
            <td style="text-align:left;">개인 보냉장구 지급</td>
            <td>${r.cooling_gear === "적정" ? "O" : ""}</td>
            <td>${r.cooling_gear === "개선필요" ? "O" : ""}</td>
            <td>${r.cooling_gear === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td rowspan="2" style="font-weight:bold;">5. 응급조치</td>
            <td style="text-align:left;">온열질환 의심자 무의식 시 즉시 119 신고</td>
            <td>${r.emergency_unconscious === "적정" ? "O" : ""}</td>
            <td>${r.emergency_unconscious === "개선필요" ? "O" : ""}</td>
            <td>${r.emergency_unconscious === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td style="text-align:left;">의식 있을 시 응급조치 후 증상 미개선 시 119 신고</td>
            <td>${r.emergency_conscious === "적정" ? "O" : ""}</td>
            <td>${r.emergency_conscious === "개선필요" ? "O" : ""}</td>
            <td>${r.emergency_conscious === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td rowspan="4" style="font-weight:bold;">6. 그 외</td>
            <td style="text-align:left;">작업장소의 체감온도 온습도계 비치</td>
            <td>${r.other_thermometer === "적정" ? "O" : ""}</td>
            <td>${r.other_thermometer === "개선필요" ? "O" : ""}</td>
            <td>${r.other_thermometer === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td style="text-align:left;">온열질환 증상 및 예방교육 실시</td>
            <td>${r.other_education === "적정" ? "O" : ""}</td>
            <td>${r.other_education === "개선필요" ? "O" : ""}</td>
            <td>${r.other_education === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td style="text-align:left;">체감온도 측정 및 조치사항 기록·보관</td>
            <td>${r.other_record === "적정" ? "O" : ""}</td>
            <td>${r.other_record === "개선필요" ? "O" : ""}</td>
            <td>${r.other_record === "해당없음" ? "O" : ""}</td>
          </tr>
          <tr>
            <td style="text-align:left;">온열질환 민감군 관리계획 수립</td>
            <td>${r.other_sensitive === "적정" ? "O" : ""}</td>
            <td>${r.other_sensitive === "개선필요" ? "O" : ""}</td>
            <td>${r.other_sensitive === "해당없음" ? "O" : ""}</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top: 20px; font-size: 12px; text-align: left;">
        <b>특이사항 및 점검비고:</b><br>
        <div style="border: 1px solid black; padding: 10px; margin-top: 5px; min-height: 80px;">${r.remarks}</div>
      </div>
    `;
    printArea.appendChild(pageDiv);
  });

  // DOM 렌더링 완료 후 print (즉시 호출 시 빈 출력 방지)
  setTimeout(() => {
    const pa = document.getElementById("print-area");
    window.print();
    // 출력 완료 후 print-area 초기화
    const cleanup = () => { if(pa) pa.innerHTML = ""; window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
  }, 300);
}

// =========================================================================
// [13. 선택 항목 삭제 기능 - 체감기록 / 자율점검표]
// =========================================================================
function deleteSelectedTempRecords() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-temp-print:checked"))
    .map(chk => chk.getAttribute("data-id"));

  if (selectedIds.length === 0) {
    alert("삭제할 체감기록을 선택해주세요.");
    return;
  }

  if (!confirm(`선택한 체감기록 ${selectedIds.length}건을 영구 삭제하시겠습니까?\n구글 시트에서도 함께 삭제되며 복구가 불가능합니다.`)) {
    return;
  }

  // ✅ 수정됨: 화면 ID 매핑 후 Sheets 영구 삭제 (고유 ID 사용)
  const recordsToDelete = tempDb.filter(r => selectedIds.includes(String(r.id)));
  const sheetIds = recordsToDelete.map(r => r.id).filter(Boolean);

  (async () => {
    try {
      const res = await gasCall({ action: "delete", target: "temp", ids: sheetIds });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
    } catch (err) {
      alert("⚠️ 구글 시트 삭제 실패\n" + err.message + "\n\n로컬 화면 갱신을 중단합니다.");
      return;
    }

    // ✅ 수정됨: 로컬 데이터베이스에서도 고유 ID를 기준으로 걸러냅니다.
    tempDb = tempDb.filter(r => !selectedIds.includes(String(r.id)));

    document.getElementById("chk-temp-all").checked = false;
    renderArchive();
    updateMissingRecordsWidget();

    alert(`${selectedIds.length}건의 체감기록이 영구 삭제되었습니다.`);
  })();
}

function deleteSelectedChecklists() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-check-print:checked"))
    .map(chk => chk.getAttribute("data-id"));

  if (selectedIds.length === 0) {
    alert("삭제할 자율점검표를 선택해주세요.");
    return;
  }

  if (!confirm(`선택한 자율점검표 ${selectedIds.length}건을 영구 삭제하시겠습니까?\n구글 시트에서도 함께 삭제되며 복구가 불가능합니다.`)) {
    return;
  }

  // [패치 ⑤-B] Sheets 영구 삭제
  (async () => {
    try {
      const res = await gasCall({ action: "delete", target: "checklist", ids: selectedIds });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
    } catch (err) {
      alert("⚠️ 구글 시트 삭제 실패\n" + err.message + "\n\n로컬 화면 갱신을 중단합니다.");
      return;
    }

    checklistDb = checklistDb.filter(r => !selectedIds.includes(r.id.toString()));

    document.getElementById("chk-check-all").checked = false;
    renderArchive();

    alert(`${selectedIds.length}건의 자율점검표가 영구 삭제되었습니다.`);
  })();
}


// =========================================================================
// [PC 대시보드 패치] 좌측 통합 관제 대시보드 렌더링 로직
// — 모바일에서는 .desktop-dashboard가 CSS로 숨겨지므로 함수가 호출돼도 영향 없음
// — Chart.js 4.x UMD가 index.html head에서 선행 로드되어야 함
// =========================================================================

let _dashLineChart = null;
let _dashDonutChart = null;
let _dashClockTimer = null;

// 폭염 단계 → 색상 (style.css의 KPI 컬러 토큰과 일관)
const STAGE_COLORS = {
  "정상":   "#2563eb",
  "관심":   "#0891b2",
  "주의":   "#ca8a04",
  "경고":   "#ea580c",
  "위험":   "#dc2626"
};
const STAGE_ORDER = ["정상", "관심", "주의", "경고", "위험"];

/**
 * 대시보드 전체 렌더링 (KPI + 라인차트 + 도넛 + 테이블 + 미제출 리스트)
 * tempDb / checklistDb 메모리 데이터를 기반으로 동작.
 */
function renderDashboard() {
  // 모바일 화면 또는 대시보드 컨테이너가 없으면 즉시 종료
  const dashEl = document.getElementById("desktop-dashboard");
  if (!dashEl || dashEl.offsetParent === null) return;
  // Chart.js 로드 실패 시 차트는 건너뛰고 KPI/테이블/미제출만 갱신
  const hasChart = (typeof window.Chart !== "undefined");

  // 기준 날짜 계산
  const today = _dashYmd(new Date());
  const weekAgo = _dashYmd(new Date(Date.now() - 6 * 86400000));

  // ── (b) KPI 계산 ──
  const todayCount = tempDb.filter(r => r.date === today).length;
  const weekRecs   = tempDb.filter(r => r.date >= weekAgo && r.date <= today);
  const attentionUp = weekRecs.filter(r => ["주의","경고","위험"].includes(r.stage)).length;
  const warningUp   = weekRecs.filter(r => ["경고","위험"].includes(r.stage)).length;
  // [TBM 패치] 4번째 KPI를 "오늘 TBM 건수"로 교체
  const todayTbm = tbmDb.filter(r => r.date === today).length;

  _setText("kpi-today-count",      todayCount);
  _setText("kpi-attention-count",  attentionUp);
  _setText("kpi-warning-count",    warningUp);
  _setText("kpi-tbm-count",        todayTbm);

  // ── (c) 라인 차트: 최근 7일 일별 평균 체감온도 ──
  const lineLabels = [];
  const lineData = [];
  const linePointColors = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const ymd = _dashYmd(d);
    lineLabels.push((d.getMonth() + 1) + "/" + d.getDate());
    const dayRecs = tempDb.filter(r => r.date === ymd);
    if (dayRecs.length === 0) {
      lineData.push(null);
      linePointColors.push("#cbd5e1");
    } else {
      const avg = dayRecs.reduce((s, r) => s + (r.perceived || 0), 0) / dayRecs.length;
      const rounded = Math.round(avg * 10) / 10;
      lineData.push(rounded);
      linePointColors.push(_dashStageOf(rounded) ? STAGE_COLORS[_dashStageOf(rounded)] : "#0891b2");
    }
  }
  _setText("chart-line-period", lineLabels[0] + " ~ " + lineLabels[lineLabels.length-1]);
  if (hasChart) _renderLineChart(lineLabels, lineData, linePointColors);

  // [수정 v3 + TBM 패치] 하단 좌: 체감기록 / 중: TBM / 우: 자율점검
  _renderDashTempList();
  _renderDashTbmList();
  _renderDashCheckList();
}

// 시계 시작 (1초 간격)
function startDashboardClock() {
  const tick = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    _setText("dash-clock", `${hh}:${mm}:${ss}`);
    const days = ["일","월","화","수","목","금","토"];
    _setText("dash-date", `${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 (${days[now.getDay()]})`);
  };
  tick();
  if (_dashClockTimer) clearInterval(_dashClockTimer);
  _dashClockTimer = setInterval(tick, 1000);
}

// 동기화 상태 칩
function setDashboardSyncStatus(ok) {
  const chip = document.getElementById("dash-sync-chip");
  const txt  = document.getElementById("dash-sync-text");
  if (!chip || !txt) return;
  if (ok) {
    chip.classList.remove("error");
    txt.textContent = "Google Sheets 동기화 정상";
  } else {
    chip.classList.add("error");
    txt.textContent = "Sheets 연결 실패 — 오프라인 모드";
  }
}

// ─── 차트 렌더 헬퍼 ───
function _renderLineChart(labels, data, pointColors) {
  const ctx = document.getElementById("chart-line-perceived");
  if (!ctx) return;
  if (_dashLineChart) _dashLineChart.destroy();
  _dashLineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "일별 평균 체감온도",
        data: data,
        borderColor: "#0891b2",
        backgroundColor: "rgba(8, 145, 178, 0.08)",
        pointBackgroundColor: pointColors,
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 6,
        pointHoverRadius: 8,
        tension: 0.35,
        fill: true,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => item.parsed.y != null ? `평균 ${item.parsed.y.toFixed(1)}℃` : "측정 없음"
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          suggestedMin: 25,
          suggestedMax: 40,
          ticks: { callback: (v) => v + "℃", font: { size: 10 } },
          grid: { color: "rgba(0,0,0,0.04)" }
        },
        x: { ticks: { font: { size: 10 } }, grid: { display: false } }
      }
    }
  });
}

// =========================================================================
// [수정 v3] 대시보드 보관소 (체감기록 대장 + 자율점검 이력) 렌더링 + 액션
// =========================================================================
function _renderDashTempList() {
  const box = document.getElementById("dash-temp-list");
  const countEl = document.getElementById("dash-temp-count");
  if (!box) return;

  _setText("dash-temp-count", tempDb.length + "건");

  if (tempDb.length === 0) {
    box.innerHTML = `<div class="dash-empty">체감기록이 아직 없습니다.</div>`;
    _wireDashAllCheck("dash-chk-temp-all", "dash-chk-temp");
    return;
  }

  // 최신순 그대로 (이미 loadFromSheets에서 정렬됨)
  box.innerHTML = tempDb.map(r => {
    const slotKor = r.slot === "AM" ? "오전 10시" : "오후 2시";
    const dateShort = r.date.substring(5).replace("-", ".");
    // ✅ 수정됨: 대시보드 리스트에도 고유 ID 할당
    const tempId = String(r.id);
    
    const badgeCls = r.stage === '정상' ? 'badge-normal'
                   : r.stage === '관심' ? 'badge-interest'
                   : r.stage === '주의' ? 'badge-attention'
                   : r.stage === '경고' ? 'badge-warning'
                   : 'badge-danger';
    return `
      <div class="dash-arc-item">
        <input type="checkbox" class="dash-chk-temp" data-id="${tempId}">
        <div class="dash-arc-item-body">
          <div class="dash-arc-item-title">${dateShort} (${slotKor}) · ${_dashTruncate(r.location, 14)}</div>
          <div class="dash-arc-item-sub">${(r.temp||0).toFixed(1)}℃ / ${r.humidity}% · 체감 ${(r.perceived||0).toFixed(1)}℃</div>
        </div>
        <div class="dash-arc-item-actions">
          <span class="badge ${badgeCls}">${r.stage}</span>
          <button class="dash-arc-btn-print" onclick="dashPrintSingleTemp('${tempId}')">
            <i class="fa-solid fa-file-pdf"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");

  _wireDashAllCheck("dash-chk-temp-all", "dash-chk-temp");
}

function _renderDashCheckList() {
  const box = document.getElementById("dash-check-list");
  if (!box) return;

  _setText("dash-check-count", checklistDb.length + "건");

  if (checklistDb.length === 0) {
    box.innerHTML = `<div class="dash-empty">자율점검 이력이 아직 없습니다.</div>`;
    _wireDashAllCheck("dash-chk-check-all", "dash-chk-check");
    return;
  }

  box.innerHTML = checklistDb.map(r => {
    // 점검 항목 중 "개선필요" 카운트
    const fields = ["water_supply","shade_cooling","shade_minimize","rest_facility","rest_31","rest_33","cooling_gear","emergency_unconscious","emergency_conscious","other_thermometer","other_education","other_record","other_sensitive"];
    const needCount = fields.filter(f => r[f] === "개선필요").length;
    const stateLabel = needCount === 0
      ? `<span class="badge badge-normal">정상 (전 항목 적정)</span>`
      : `<span class="badge badge-warning">개선필요 ${needCount}건</span>`;
    return `
      <div class="dash-arc-item">
        <input type="checkbox" class="dash-chk-check" data-id="${r.id}">
        <div class="dash-arc-item-body">
          <div class="dash-arc-item-title">${r.date} · 주간 자율점검표</div>
          ${r.remarks ? `<div class="dash-arc-item-sub">${_dashTruncate(r.remarks, 28)}</div>` : ''}
        </div>
        <div class="dash-arc-item-actions">
          ${stateLabel}
          <button class="dash-arc-btn-print" onclick="dashPrintSingleCheck('${r.id}')">
            <i class="fa-solid fa-file-pdf"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");

  _wireDashAllCheck("dash-chk-check-all", "dash-chk-check");
}

// 전체선택 체크박스 바인딩
function _wireDashAllCheck(allId, itemClass) {
  const allChk = document.getElementById(allId);
  if (!allChk) return;
  allChk.onchange = () => {
    document.querySelectorAll("." + itemClass).forEach(c => c.checked = allChk.checked);
  };
  allChk.checked = false;
}

// ── 대시보드 선택삭제/출력 액션 — 모바일 기존 함수 재활용 ──
function dashDeleteSelectedTemp() {
  const ids = Array.from(document.querySelectorAll(".dash-chk-temp:checked"))
    .map(c => c.getAttribute("data-id"));
  if (ids.length === 0) { alert("삭제할 체감기록을 선택해주세요."); return; }
  // 모바일 보관소의 체크박스를 동일 ID로 일시 체크해두고, 기존 영구삭제 함수 호출
  document.querySelectorAll(".chk-temp-print").forEach(c => {
    c.checked = ids.includes(c.getAttribute("data-id"));
  });
  deleteSelectedTempRecords();
}

function dashDeleteSelectedCheck() {
  const ids = Array.from(document.querySelectorAll(".dash-chk-check:checked"))
    .map(c => c.getAttribute("data-id"));
  if (ids.length === 0) { alert("삭제할 자율점검표를 선택해주세요."); return; }
  document.querySelectorAll(".chk-check-print").forEach(c => {
    c.checked = ids.includes(c.getAttribute("data-id"));
  });
  deleteSelectedChecklists();
}

function dashPrintSelectedTemp() {
  const ids = Array.from(document.querySelectorAll(".dash-chk-temp:checked"))
    .map(c => c.getAttribute("data-id"));
  if (ids.length === 0) { alert("출력할 체감기록을 선택해주세요."); return; }
  document.querySelectorAll(".chk-temp-print").forEach(c => {
    c.checked = ids.includes(c.getAttribute("data-id"));
  });
  printSelectedTempRecords();
}

function dashPrintSelectedCheck() {
  const ids = Array.from(document.querySelectorAll(".dash-chk-check:checked"))
    .map(c => c.getAttribute("data-id"));
  if (ids.length === 0) { alert("출력할 자율점검표를 선택해주세요."); return; }
  document.querySelectorAll(".chk-check-print").forEach(c => {
    c.checked = ids.includes(c.getAttribute("data-id"));
  });
  printSelectedChecklists();
}

function dashPrintSingleTemp(tempId) {
  document.querySelectorAll(".chk-temp-print").forEach(c => c.checked = false);
  const target = document.querySelector(`.chk-temp-print[data-id="${tempId}"]`);
  if (target) target.checked = true;
  printSelectedTempRecords();
}

function dashPrintSingleCheck(checkId) {
  document.querySelectorAll(".chk-check-print").forEach(c => c.checked = false);
  const target = document.querySelector(`.chk-check-print[data-id="${checkId}"]`);
  if (target) target.checked = true;
  printSelectedChecklists();
}

// ─── 공용 유틸 ───
function _dashYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function _dashYmdToDate(ymd) {
  const [y,m,d] = ymd.split("-").map(Number);
  return new Date(y, m-1, d);
}
function _dashStageOf(perceived) {
  if (perceived >= 38) return "위험";
  if (perceived >= 35) return "경고";
  if (perceived >= 33) return "주의";
  if (perceived >= 31) return "관심";
  return "정상";
}
function _dashTruncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.substring(0, n) + "…" : s;
}
function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}


// =========================================================================
// [TBM 패치] TBM 자가진단 체크리스트 — 작성 화면 + 제출 + 보관소 + 출력/삭제
// =========================================================================

// TBM 작성 화면 초기 세팅 (토글/제출/보관소 액션 바인딩) — 9개 항목은 HTML에 정적으로 박혀 있음
function initTbmScreen() {
  const container = document.getElementById("tbm-items-container");
  if (!container) return;

  // [핵심 수정] HTML에 9개 항목이 이미 정적으로 박혀 있으므로 innerHTML 동적 생성 제거.
  // 자율점검표와 동일한 패턴으로, 정적 HTML의 .yn-btn에 토글 동작만 바인딩.

  // 토글 동작 바인딩 (자율점검과 같은 패턴)
  container.querySelectorAll(".chk-item-row").forEach(row => {
    row.querySelectorAll(".yn-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        row.querySelectorAll(".yn-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  });

  // 제출 버튼 → [신규] 서명 모달 먼저 오픈
  const submitBtn = document.getElementById("btn-submit-tbm");
  if (submitBtn) submitBtn.addEventListener("click", () => {
    signContext = "tbm";  // [신규] TBM 컨텍스트
    openSignModal();
  });

  // 보관소 TBM 서브탭의 전체선택 / 출력 / 삭제 버튼
  const allChk = document.getElementById("chk-tbm-all");
  if (allChk) {
    allChk.addEventListener("change", () => {
      document.querySelectorAll(".chk-tbm-print").forEach(c => c.checked = allChk.checked);
    });
  }
  const btnPrint = document.getElementById("btn-print-selected-tbm");
  if (btnPrint) btnPrint.addEventListener("click", printSelectedTbm);
  const btnDelete = document.getElementById("btn-delete-selected-tbm");
  if (btnDelete) btnDelete.addEventListener("click", deleteSelectedTbm);
}

// TBM 제출 — Google Sheets에 영구 저장
function submitTbm() {
  const submitBtn = document.getElementById("btn-submit-tbm");
  const dateStr = document.getElementById("m-input-tbm-date").value;
  const deptEl = document.getElementById("m-input-tbm-dept");
  const deptStr = deptEl ? deptEl.value : "";
  const remarks = document.getElementById("tbm-input-remarks").value || "";

  if (!dateStr) {
    alert("작성 날짜를 선택해주세요.");
    return;
  }

  // 9개 항목 값 수집
  const record = { date: dateStr, dept: deptStr, inspector: "보건관리자", remarks: remarks, signature: savedSignatureDataUrl };
  TBM_QUESTIONS.forEach(q => {
    const row = document.querySelector(`#tbm-items-container .chk-item-row[data-key="${q.key}"]`);
    const active = row ? row.querySelector(".yn-btn.active") : null;
    record[q.key] = active ? active.getAttribute("data-val") : q.defaultVal;
  });

  // 위험 신호 (1~6번 중 "예") + 서약 미이행 (8~9번 중 "아니오") 카운트 → 경고
  const riskHits = TBM_QUESTIONS.filter(q => q.riskOnYes && record[q.key] === "예").length;
  const pledgeMiss = TBM_QUESTIONS.filter(q => q.category === "pledge" && record[q.key] === "아니오").length;

  if (riskHits >= 2) {
    if (!confirm(`⚠️ 위험 신호 ${riskHits}건 감지됨\n그래도 제출하시겠습니까?\n(저장 후 안전관리자에게 즉시 보고를 권장합니다)`)) return;
  }
  if (pledgeMiss > 0) {
    if (!confirm(`⚠️ 안전수칙 서약 미이행 ${pledgeMiss}건\n그래도 제출하시겠습니까?`)) return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 구글 시트 저장 중...`;

  setTimeout(async () => {
    try {
      const res = await gasCall({ action: "create", target: "tbm", record: record });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
      if (res.id) record.id = res.id;
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-pen-nib"></i> 기록 및 전자 서명하기`;
      alert("⚠️ 구글 시트 저장 실패\n" + err.message);
      return;
    }

    tbmDb.unshift(record);

    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-pen-nib"></i> 기록 및 전자 서명하기`;

    // 보관소 TBM 서브탭으로 이동
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".app-screen").forEach(s => s.classList.remove("active"));
    document.querySelector(".nav-item[data-screen='screen-archive']").classList.add("active");
    document.getElementById("screen-archive").classList.add("active");

    document.querySelectorAll(".archive-sub-tabs .sub-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".archive-sub-pane").forEach(p => p.classList.remove("active"));
    const tbmTabBtn = document.querySelector(".sub-tab-btn[data-sub='sub-tbm']");
    const tbmPane = document.getElementById("sub-tbm");
    if (tbmTabBtn) tbmTabBtn.classList.add("active");
    if (tbmPane) tbmPane.classList.add("active");

    renderArchive();

    alert(`[TBM 완료] ${dateStr} 작업 전 안전점검이 DB에 등록되었습니다.${riskHits > 0 ? `\n⚠️ 위험 신호 ${riskHits}건 — 관리자 보고 권장` : ''}`);
  }, 600);
}

// TBM 보관소 리스트 렌더링 (모바일 보관소의 sub-tbm 페인)
function renderTbmArchiveList() {
  const box = document.getElementById("archive-tbm-list");
  if (!box) return;

  if (tbmDb.length === 0) {
    box.innerHTML = `<div style="padding: 30px 0; text-align: center; color: var(--text-muted); font-size: 13px;">TBM 자가진단 기록이 아직 없습니다.</div>`;
    return;
  }

  box.innerHTML = tbmDb.map(r => {
    const riskHits = TBM_QUESTIONS.filter(q => q.riskOnYes && r[q.key] === "예").length;
    const pledgeMiss = TBM_QUESTIONS.filter(q => q.category === "pledge" && r[q.key] === "아니오").length;
    const overall = (riskHits >= 1 || pledgeMiss > 0) ? '주의' : '정상';
    const badgeCls = (riskHits >= 1 || pledgeMiss > 0) ? 'badge-attention' : 'badge-normal';

    return `
      <div class="archive-card-compact">
        <div class="acc-left">
          <input type="checkbox" class="chk-tbm-print" data-id="${r.id}">
          <span class="acc-date">${r.date}</span>
          <span class="card-slot-chip">TBM</span>
        </div>
        <div class="acc-mid">
          <img class="acc-sign" src="${r.signature || dummySignature}" alt="서명">
        </div>
        <div class="acc-right">
          <span class="badge ${badgeCls}">${overall}</span>
          <button class="acc-pdf-btn" onclick="printSingleTbm('${r.id}')">
            <i class="fa-solid fa-file-pdf"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

// TBM 영구 삭제 (체크된 항목)
function deleteSelectedTbm() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-tbm-print:checked"))
    .map(chk => chk.getAttribute("data-id"));

  if (selectedIds.length === 0) {
    alert("삭제할 TBM 기록을 선택해주세요.");
    return;
  }

  if (!confirm(`선택한 TBM 기록 ${selectedIds.length}건을 영구 삭제하시겠습니까?\n구글 시트에서도 함께 삭제되며 복구가 불가능합니다.`)) {
    return;
  }

  (async () => {
    try {
      const res = await gasCall({ action: "delete", target: "tbm", ids: selectedIds });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
    } catch (err) {
      alert("⚠️ 구글 시트 삭제 실패\n" + err.message);
      return;
    }

    tbmDb = tbmDb.filter(r => !selectedIds.includes(r.id.toString()));

    const allChk = document.getElementById("chk-tbm-all");
    if (allChk) allChk.checked = false;
    renderArchive();

    alert(`${selectedIds.length}건의 TBM 기록이 영구 삭제되었습니다.`);
  })();
}

// TBM 선택 출력 (PDF 인쇄)
function printSelectedTbm() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-tbm-print:checked"))
    .map(chk => chk.getAttribute("data-id"));
  if (selectedIds.length === 0) {
    alert("출력할 TBM 기록을 선택해주세요.");
    return;
  }
  _buildTbmPrintAndPrint(selectedIds);
}

function printSingleTbm(tbmId) {
  _buildTbmPrintAndPrint([tbmId]);
}

function _buildTbmPrintAndPrint(ids) {
  const records = tbmDb.filter(r => ids.includes(r.id.toString()));
  if (records.length === 0) return;

  // A4 1장에 TBM 2개씩: 짝수 인덱스(0,2,4…)끼리 묶어서 페이지 구성
  const pages = [];
  for (let i = 0; i < records.length; i += 2) {
    pages.push(records.slice(i, i + 2));
  }

  const buildOne = (r) => {
    const rows = TBM_QUESTIONS.map(q => {
      const val = r[q.key];
      const isAbnormal = (q.riskOnYes && val === "예") || (q.category === "pledge" && val === "아니오");
      return `<tr>
        <td style="text-align:center;font-weight:600;padding:5px 4px;width:38px;">${q.key.toUpperCase()}</td>
        <td style="padding:5px 7px;text-align:left;line-height:1.4;"><strong>${q.label}</strong> ${q.text}</td>
        <td style="text-align:center;font-weight:800;padding:5px 4px;width:44px;color:${isAbnormal ? '#dc2626' : '#0f172a'};">${val}</td>
      </tr>`;
    }).join("");

    return `
      <div class="tbm-block">
        <div class="tbm-title">TBM (Tool Box Meeting) 자가진단 체크리스트</div>
        <div class="tbm-sub">작업 전 안전회의 — 부민병원그룹</div>
        <table class="tbm-meta">
          <colgroup>
            <col style="width:13%">
            <col style="width:22%">
            <col style="width:13%">
            <col style="width:26%">
            <col style="width:13%">
            <col style="width:13%">
          </colgroup>
          <tr>
            <td class="meta-hd">작성일</td>
            <td class="meta-val">${r.date}</td>
            <td class="meta-hd">서명</td>
            <td class="meta-val">${r.signature ? `<img src="${r.signature}" style="height:26px;max-width:90px;object-fit:contain;vertical-align:middle;">` : '-'}</td>
            <td class="meta-hd">작성 부서</td>
            <td class="meta-val">${r.dept || '-'}</td>
          </tr>
        </table>
        <table class="tbm-body">
          <thead>
            <tr>
              <th style="width:38px;">No.</th>
              <th style="text-align:left;">자가진단 항목</th>
              <th style="width:44px;">결과</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${r.remarks ? `<div class="tbm-remarks"><strong>특이사항:</strong> ${r.remarks}</div>` : ''}
      </div>`;
  };

  const html = pages.map((pair, pi) => {
    const inner = pair.map(r => buildOne(r)).join('<div class="tbm-divider"></div>');
    const isLast = pi === pages.length - 1;
    return `<div class="tbm-page${isLast ? '' : ' page-break'}">${inner}</div>`;
  }).join("");

  const style = `
    @page { size: A4 portrait; margin: 10mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Pretendard', sans-serif; color: #0f172a; margin: 0; padding: 0; font-size: 10px; }
    .tbm-page { width: 100%; }
    .page-break { page-break-after: always; }
    .tbm-block { width: 100%; margin-bottom: 0; }
    .tbm-divider { height: 8px; border-top: 1.5px dashed #94a3b8; margin: 7px 0; }
    .tbm-title { text-align:center; font-size:14px; font-weight:800; margin:0 0 2px 0; }
    .tbm-sub { text-align:center; font-size:9px; color:#64748b; margin:0 0 6px 0; }
    /* 메타 테이블 (한 줄: 작성일 | 값 | 서명 | 값 | 작성부서 | 값) */
    table.tbm-meta { width:100%; border-collapse:collapse; margin-bottom:5px; font-size:10px; }
    table.tbm-meta td { border:1px solid #94a3b8; padding:5px 6px; }
    td.meta-hd { background:#e2e8f0; font-weight:700; text-align:center; white-space:nowrap; }
    td.meta-val { }
    /* 본문 체크리스트 테이블 */
    table.tbm-body { width:100%; border-collapse:collapse; font-size:10px; }
    table.tbm-body th { background:#0891b2; color:#fff; padding:5px 4px; border:1px solid #94a3b8; text-align:center; }
    table.tbm-body td { border:1px solid #cbd5e1; vertical-align:middle; }
    table.tbm-body tbody tr td { height:22px; }
    .tbm-remarks { margin-top:5px; padding:5px 8px; border:1px dashed #cbd5e1; font-size:9.5px; }
  `;

  const w = window.open("", "TBM_PRINT", "width=900,height=1200");
  if (!w) {
    // 팝업 차단 시 print-area 방식으로 폴백
    const pa = document.getElementById("print-area");
    pa.innerHTML = `<div style="font-family:'Pretendard',sans-serif;color:#0f172a;">${html}</div>`;
    setTimeout(() => {
      window.print();
      const cleanup = () => { pa.innerHTML = ""; window.removeEventListener("afterprint", cleanup); };
      window.addEventListener("afterprint", cleanup);
    }, 300);
    return;
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>TBM 자가진단 출력</title>
    <style>${style}</style>
    </head><body>${html}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
}

// =========================================================================
// [TBM 패치] 대시보드 TBM 카드 렌더링 + 액션
// =========================================================================
function _renderDashTbmList() {
  const box = document.getElementById("dash-tbm-list");
  if (!box) return;

  _setText("dash-tbm-count", tbmDb.length + "건");

  if (tbmDb.length === 0) {
    box.innerHTML = `<div class="dash-empty">TBM 기록이 아직 없습니다.</div>`;
    _wireDashAllCheck("dash-chk-tbm-all", "dash-chk-tbm");
    return;
  }

  box.innerHTML = tbmDb.map(r => {
    const riskHits = TBM_QUESTIONS.filter(q => q.riskOnYes && r[q.key] === "예").length;
    const pledgeMiss = TBM_QUESTIONS.filter(q => q.category === "pledge" && r[q.key] === "아니오").length;
    const badgeCls = riskHits >= 2 ? 'badge-danger'
                   : riskHits >= 1 ? 'badge-warning'
                   : pledgeMiss > 0 ? 'badge-attention'
                   : 'badge-normal';
    const badgeLbl = riskHits >= 1 ? `위험 ${riskHits}건`
                   : pledgeMiss > 0 ? `미이행 ${pledgeMiss}건`
                   : '정상';
    return `
      <div class="dash-arc-item">
        <input type="checkbox" class="dash-chk-tbm" data-id="${r.id}">
        <div class="dash-arc-item-body">
          <div class="dash-arc-item-title">${r.date} · TBM 자가진단</div>
          ${r.remarks ? `<div class="dash-arc-item-sub">${_dashTruncate(r.remarks, 28)}</div>` : ''}
        </div>
        <div class="dash-arc-item-actions">
          <span class="badge ${badgeCls}">${badgeLbl}</span>
          <button class="dash-arc-btn-print" onclick="printSingleTbm('${r.id}')">
            <i class="fa-solid fa-file-pdf"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");

  _wireDashAllCheck("dash-chk-tbm-all", "dash-chk-tbm");
}

function dashDeleteSelectedTbm() {
  const ids = Array.from(document.querySelectorAll(".dash-chk-tbm:checked"))
    .map(c => c.getAttribute("data-id"));
  if (ids.length === 0) { alert("삭제할 TBM 기록을 선택해주세요."); return; }
  document.querySelectorAll(".chk-tbm-print").forEach(c => {
    c.checked = ids.includes(c.getAttribute("data-id"));
  });
  deleteSelectedTbm();
}

function dashPrintSelectedTbm() {
  const ids = Array.from(document.querySelectorAll(".dash-chk-tbm:checked"))
    .map(c => c.getAttribute("data-id"));
  if (ids.length === 0) { alert("출력할 TBM 기록을 선택해주세요."); return; }
  printSelectedTbm.call(null, ids);
  // ↑ printSelectedTbm은 DOM 체크박스 기반이므로, 일시적으로 모바일 체크박스에 반영 후 호출
  document.querySelectorAll(".chk-tbm-print").forEach(c => {
    c.checked = ids.includes(c.getAttribute("data-id"));
  });
  printSelectedTbm();
}
