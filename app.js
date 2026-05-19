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
  });
  updateMissingRecordsWidget();

  // 이벤트 트리거 바인딩
  document.getElementById("btn-slot-am").addEventListener("click", () => setSlot("AM"));
  document.getElementById("btn-slot-pm").addEventListener("click", () => setSlot("PM"));
  
  document.getElementById("btn-open-sign-modal").addEventListener("click", openSignModal);
  document.getElementById("btn-close-sign").addEventListener("click", () => document.getElementById("sign-pad-modal").classList.remove("active"));
  document.getElementById("btn-close-viewer").addEventListener("click", () => document.getElementById("checklist-viewer-modal").classList.remove("active"));
  
  document.getElementById("btn-final-submit").addEventListener("click", submitRecordFinal);
  document.getElementById("btn-submit-checklist").addEventListener("click", submitChecklist);
  
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

  if (slot === "AM") {
    amBtn.classList.add("active");
    pmBtn.classList.remove("active");
  } else {
    pmBtn.classList.add("active");
    amBtn.classList.remove("active");
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
  // [모바일 패치] dpr 보정된 좌표계 기준으로 CSS 픽셀 영역 전체 클리어
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
}

// 서명 저장 및 결과 확인 모달로 연동
function saveSignature() {
  // 캔버스 드로잉 데이터 PNG 파일(DataURL) 변환
  savedSignatureDataUrl = canvas.toDataURL();
  
  // 확인 결과 모달 정보 바인딩
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
  // 모달을 열 때 캔버스 초기화
  clearCanvas();
  document.getElementById("sign-pad-modal").classList.add("active");
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
  const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

  const record = {
    id: newId,
    date: dateStr,
    slot: activeSlot,
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
    remarks: remarks
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
      submitBtn.innerHTML = `<i class="fa-solid fa-file-shield"></i> 주간 자율점검표 제출`;
      alert("⚠️ 구글 시트 저장 실패\n" + err.message + "\n\n네트워크나 GAS Web App URL을 확인해주세요.");
      return;
    }

    checklistDb.unshift(record);
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="fa-solid fa-file-shield"></i> 주간 자율점검표 제출`;

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
  const container = document.getElementById("missing-list-container");
  container.innerHTML = "";

  // 최근 4일간 슬롯 생성 (AM, PM)
  const today = new Date();
  let missingSlotsCount = 0;

  for (let i = 0; i < 4; i++) {
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - i);
    
    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const d = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    const slots = ["AM", "PM"];
    
    slots.forEach(slot => {
      // 당일 오늘 오후의 경우 아직 시간상 작성 전일 수 있으므로 누락 처리에서 스킵
      if (i === 0 && slot === "PM" && today.getHours() < 14) {
        return;
      }

      // 데이터 검색
      const exist = tempDb.find(r => r.date === dateStr && r.slot === slot);
      
      if (!exist) {
        missingSlotsCount++;
        const card = document.createElement("div");
        card.className = "missing-row-card";
        
        const slotKor = slot === "AM" ? "오전 10시 측정" : "오후 2시 측정";
        
        card.innerHTML = `
          <span class="date-lbl"><i class="fa-regular fa-clock"></i> ${dateStr.substring(5).replace('-', '.')} [${slotKor}]</span>
          <span class="alert-tag">기록 누락됨</span>
        `;

        // 누락 카드 누르면 바로 작성 화면으로 점프 & 사후 기입 유도
        card.addEventListener("click", () => {
          setSlot(slot);
          
          // 작성일자를 누락된 일자로 동적 강제 세팅 (사후 누락 보완)
          alert(`[누락 보관 보완] ${dateStr} ${slotKor} 기록 작성을 시작합니다.`);
          
          // 화면 전환
          document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
          document.querySelectorAll(".app-screen").forEach(s => s.classList.remove("active"));
          document.querySelector(".nav-item[data-screen='screen-record']").classList.add("active");
          document.getElementById("screen-record").classList.add("active");
        });

        container.appendChild(card);
      }
    });
  }

  const widget = document.getElementById("missing-records-box");
  if (missingSlotsCount === 0) {
    widget.style.display = "none"; // 누락 없음 시 박스 숨김
  } else {
    widget.style.display = "block";
    widget.querySelector("span").innerText = `미제출 누락 기록지 ${missingSlotsCount}건 보관 중!`;
  }
}

// =========================================================================
// [패치 ③] Google Sheets에서 데이터 로드 (페이지 진입 시 1회)
// =========================================================================
async function loadFromSheets() {
  try {
    const [tempRes, chkRes] = await Promise.all([
      gasCall({ action: "list", target: "temp" }),
      gasCall({ action: "list", target: "checklist" })
    ]);

    if (tempRes && tempRes.ok && Array.isArray(tempRes.records)) {
      tempDb = tempRes.records
        .filter(r => r["ID"])
        .map(r => ({
          id: String(r["ID"]),
          date: _formatDateOnly(r["기록일시"]),
          slot: r["시간슬롯"] || "AM",
          time: _formatTimeOnly(r["기록일시"]),
          inspector: r["측정자"] || "보건관리자",
          location: r["측정 장소"] || "",
          temp: parseFloat(r["기온"]) || 0,
          humidity: parseFloat(r["습도"]) || 0,
          perceived: parseFloat(r["체감온도"]) || 0,
          stage: r["폭염 단계"] || "정상",
          action: koshaActions[r["폭염 단계"]] || koshaActions["정상"],
          signature: r["서명"] || dummySignature,
          remarks: r["특이사항"] || ""
        }))
        .sort((a, b) => (b.date + b.slot).localeCompare(a.date + a.slot));
    }

    if (chkRes && chkRes.ok && Array.isArray(chkRes.records)) {
      checklistDb = chkRes.records
        .filter(r => r["ID"])
        .map(r => ({
          id: String(r["ID"]),
          date: _formatDateOnly(r["점검일시"]),
          water_supply: r["물_식수제공"] || "적정",
          shade_cooling: r["그늘_냉방그늘막"] || "적정",
          shade_minimize: r["그늘_노출최소화"] || "적정",
          rest_facility: r["휴식_휴게시설"] || "적정",
          rest_31: r["휴식_31도휴식"] || "적정",
          rest_33: r["휴식_33도휴식"] || "적정",
          cooling_gear: r["보냉장구_개인지급"] || "적정",
          emergency_unconscious: r["응급조치_무의식신고"] || "적정",
          emergency_conscious: r["응급조치_의식응급조치"] || "적정",
          other_thermometer: r["그외_온습도계"] || "적정",
          other_education: r["그외_안전교육"] || "적정",
          other_record: r["그외_기록보관"] || "적정",
          other_sensitive: r["그외_민감군계획"] || "적정",
          remarks: r["특이사항"] || ""
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
    }
  } catch (err) {
    console.error("[Sheets 로드 실패]", err);
    alert("⚠️ Google Sheets 데이터 로드 실패\n" + err.message + "\n\n임시로 빈 상태에서 동작합니다. 새 기록 저장도 실패할 수 있습니다.");
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

// 보관소 리스트 렌더링
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
    const tempId = row.date + "_" + row.slot;
    
    card.innerHTML = `
      <div class="t-rec-top">
        <span class="tr-dt" style="display:flex; align-items:center;">
          <input type="checkbox" class="chk-item-print chk-temp-print" data-id="${tempId}">
          <i class="fa-regular fa-calendar-check" style="margin-left: 5px; margin-right: 5px;"></i> ${dateFormatted} (${slotKor})
        </span>
        <span class="tr-time">${row.time} 전송</span>
      </div>
      <div class="t-rec-body">
        <span class="tr-vals">${row.location} - <strong>${row.temp.toFixed(1)}℃</strong> / <strong>${row.humidity}%</strong></span>
        <span class="badge ${row.stage === '정상' ? 'badge-normal' : row.stage === '관심' ? 'badge-interest' : row.stage === '주의' ? 'badge-attention' : row.stage === '경고' ? 'badge-warning' : 'badge-danger'}">${row.stage}</span>
      </div>
      <div class="t-rec-footer">
        <div class="t-rec-sign-thumb">
          <span>작성자 서명:</span>
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

  filteredChecklistDb.forEach(row => {
    const rowDiv = document.createElement("div");
    rowDiv.className = "check-history-row";
    
    rowDiv.innerHTML = `
      <div class="c-hist-info" style="display:flex; align-items:center;">
        <input type="checkbox" class="chk-item-print chk-check-print" data-id="${row.id}">
        <span class="c-h-date"><i class="fa-regular fa-calendar" style="margin-left:5px; margin-right:5px;"></i> 점검일: ${row.date}</span>
      </div>
      <div class="c-hist-icon" style="display: flex; gap: 10px; align-items: center;">
        <button class="m-btn m-btn-green btn-print-check" style="margin: 0; padding: 4px 8px; font-size: 10px;" data-id="${row.id}"><i class="fa-solid fa-file-pdf"></i> 개별 출력</button>
        <i class="fa-solid fa-chevron-right"></i>
      </div>
    `;

    // 🌟 날짜를 클릭하면 팝업 상세 모달 오픈 (핵심 요구사항)
    rowDiv.addEventListener("click", () => {
      openChecklistViewer(row);
    });

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
function printSelectedTempRecords() {
  const selectedIds = Array.from(document.querySelectorAll(".chk-temp-print:checked")).map(chk => chk.getAttribute("data-id"));
  if (selectedIds.length === 0) {
    alert("출력할 체감기록을 선택해주세요.");
    return;
  }
  
  // 선택된 기록들만 필터링 후 시간순 정렬
  const records = tempDb.filter(r => selectedIds.includes(r.date + "_" + r.slot))
                        .sort((a, b) => new Date(a.date) - new Date(b.date));

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
          <td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
        </tr>
    `;
  }

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
          <th colspan="3">항목</th>
          <th colspan="5">구분 (체감온도 기준)</th>
          <th rowspan="2" width="23%">조치사항</th>
          <th rowspan="2" width="13%">비고</th>
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

  window.print();
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

  window.print();
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

  // [패치 ⑤-A] 화면 ID(date_slot) → 시트 ID(TMP-xxx) 매핑 후 Sheets 영구 삭제
  const recordsToDelete = tempDb.filter(r => selectedIds.includes(r.date + "_" + r.slot));
  const sheetIds = recordsToDelete.map(r => r.id).filter(Boolean);

  (async () => {
    try {
      const res = await gasCall({ action: "delete", target: "temp", ids: sheetIds });
      if (!res || !res.ok) throw new Error((res && res.error) || "응답 오류");
    } catch (err) {
      alert("⚠️ 구글 시트 삭제 실패\n" + err.message + "\n\n로컬 화면 갱신을 중단합니다.");
      return;
    }

    tempDb = tempDb.filter(r => !selectedIds.includes(r.date + "_" + r.slot));

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

