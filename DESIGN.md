# 폭염 건강장애 예방 시스템 구축 가이드 (KOSHA 가이드라인 준수)

본 가이드는 안전보건공단(KOSHA)의 **'온열질환 예방 가이드'**를 완벽하게 반영하여, 현장 작업자의 폭염 건강장애를 예방하기 위한 자동화 시스템 구축 방안을 제시합니다. 
데이터베이스(Google Sheets), 프론트엔드(AppSheet), 백엔드 자동화 및 즉각 알림(Google Apps Script, GAS)을 유기적으로 연동합니다.

---

## 1. Google Sheets 데이터베이스 구조 및 자동화 수식

Google Sheets는 데이터 저장 및 백그라운드 데이터 가공 역할을 수행합니다. 각 시트의 헤더 구조와 자동으로 계산을 수행하는 `ArrayFormula` 수식은 다음과 같습니다.

### 1-1. '자율점검표' 시트 구조
폭염 5대 기본수칙(물, 그늘, 휴식, 보냉장구, 응급조치) 및 민감군 관리를 현장 보건관리자가 KOSHA 공식 13개 세부 점검 항목으로 종합 평가하여 기록을 저장합니다. (특정 구역별이 아닌 모든 구역 통합으로 이루어지며, Y/N 평가 방식에서 3단계 상태 평가로 개편되었습니다.)

| 열 문자 | 열 이름 (Header) | 데이터 타입 | 설명 / AppSheet 연동 설정 |
| :---: | :--- | :---: | :--- |
| **A** | `ID` | Text | 고유 키 (AppSheet에서 `UNIQUEID()` 자동 부여) |
| **B** | `점검일시` | DateTime | 점검이 이루어진 일자와 시간 (`NOW()`) |
| **C** | `점검자` | Email | 점검자의 이메일 주소 (`USEREMAIL()`) |
| **D** | `물_식수제공` | Enum | 시원하고 깨끗한 물을 충분히 제공 (적정 / 개선필요 / 해당없음) |
| **E** | `그늘_냉방그늘막` | Enum | 실내·옥외작업 시 냉방·통풍장치 및 그늘막 설치 여부 점검 |
| **F** | `그늘_노출최소화` | Enum | 작업시간대 조정 등 폭염 집중 시간대 노출 최소화 여부 점검 |
| **G** | `휴식_휴게시설` | Enum | 작업장소와 가까운 곳에 휴게시설 설치 및 물품 비치 점검 |
| **H** | `휴식_31도휴식` | Enum | 체감온도 31도 이상 폭염작업 시 적절한 휴식 제공 점검 |
| **I** | `휴식_33도휴식` | Enum | 체감온도 33도 이상 폭염작업 시 2시간 이내 20분 이상 휴식 점검 |
| **J** | `보냉장구_개인지급` | Enum | 냉각의류, 냉각조끼 등 개인 보냉장구 지급 상태 점검 |
| **K** | `응급조치_무의식신고` | Enum | 온열질환자 발생 시 의식이 없는 경우 즉시 119 신고 체계 점검 |
| **L** | `응급조치_의식응급조치`| Enum | 의식이 있는 경우 응급조치 후 증상 미개선 시 119 신고 체계 점검 |
| **M** | `그외_온습도계` | Enum | 작업장소의 체감온도를 알 수 있는 온습도계 비치 상태 점검 |
| **N** | `그외_안전교육` | Enum | 온열질환 증상 및 예방방법, 응급조치 요령 교육 실시 점검 |
| **O** | `그외_기록보관` | Enum | 체감온도를 측정하고 조치사항 기록·보관 준수 여부 점검 |
| **P** | `그외_민감군계획` | Enum | 온열질환 민감군 관리계획 수립 및 실천 현황 점검 |
| **Q** | `특이사항` | LongText | 점검 시 발견된 개선 조치사항 및 보완대책 기술 |

---

### 1-2. '체감온도_기록지' 시트 구조 및 ArrayFormula 수식
작업 장소별 기온과 습도를 입력하면 기상청의 **여름철 약식 체감온도 산출 공식**을 적용하여 폭염 단계와 그에 해당하는 KOSHA 기준 조치사항을 실시간으로 자동 산출합니다.

> **기상청 여름철 약식 공식:**
> $$\text{체감온도(} ^\circ\text{C)} = \text{기온} + 0.14 \times (\text{습도} - 50)$$

#### 1) 시트 구성

| 열 문자 | 열 이름 (Header) | 데이터 타입 | 수식 처리 방식 |
| :---: | :--- | :---: | :--- |
| **A** | `ID` | Text | AppSheet 자동 생성 고유 키 (`UNIQUEID()`) |
| **B** | `기록일시` | DateTime | 데이터 기록 시점 (`NOW()`) |
| **C** | `기록자` | Email | 기록자 이메일 (`USEREMAIL()`) |
| **D** | `측정 장소` | Enum | 본관 지하2층 기계실 등 5개 지정 장소 |
| **E** | `기온` | Decimal | 현장 측정 기온 ($^\circ\text{C}$) |
| **F** | `습도` | Number | 현장 측정 습도 ($\%$, 0~100 사이 정수 입력) |
| **G** | `체감온도` | Decimal | **[자동]** 기상청 공식 기반 자동 계산 (소수점 첫째자리 반올림) |
| **H** | `폭염 단계` | Text | **[자동]** 체감온도 수준에 따른 5단계 구분 (정상~위험) |
| **I** | `조치사항` | Text | **[자동]** KOSHA 가이드라인에 따른 단계별 의무 현장 조치사항 |

#### 2) Google Sheets 헤더 자동 적용형 ArrayFormula 3종
행이 무한히 늘어나도 수식을 복사할 필요가 없도록 **1행(헤더 행)에 직접 삽입하여 작동하는 무중단 ArrayFormula**입니다. 데이터가 없는 빈 행은 깔끔하게 공백 처리합니다.

*   **G1 셀(체감온도) 입력 수식:**
    ```excel
    =ARRAYFORMULA(IF(ROW(A:A)=1, "체감온도", IF(ISBLANK(E:E), "", ROUND(E:E + 0.14 * (F:F - 50), 1))))
    ```
    *(※ 주의: E열은 기온, F열은 습도 기준입니다. 기온(E열)이 입력되었을 때만 계산하며, 소수점 첫째자리로 반올림(`ROUND`) 처리합니다.)*

*   **H1 셀(폭염 단계) 입력 수식:**
    ```excel
    =ARRAYFORMULA(IF(ROW(A:A)=1, "폭염 단계", IF(ISBLANK(G:G), "", IFS(G:G >= 38, "위험", G:G >= 35, "경고", G:G >= 33, "주의", G:G >= 31, "관심", TRUE, "정상"))))
    ```
    *(※ G열의 체감온도를 참조하여 KOSHA 지정 온도 구간별 단계를 매핑합니다.)*

*   **I1 셀(조치사항) 입력 수식:**
    ```excel
    =ARRAYFORMULA(IF(ROW(A:A)=1, "조치사항", IF(ISBLANK(H:H), "", IFS(
      H:H = "위험", "매시간 15분 이상씩 또는 2시간 이내 20분 이상 휴식, 재난/안전 등 긴급조치 외 무더위 시간대 옥외작업 전면 중지",
      H:H = "경고", "매시간 15분씩 또는 2시간 이내 20분 이상 휴식, 무더위 시간대 불가피한 경우 제외 옥외작업 중지, 민감군 옥외작업 제한",
      H:H = "주의", "매시간 10분씩 또는 2시간 이내 20분 이상 휴식, 무더위 시간대 옥외작업 단축, 보냉장구 지급",
      H:H = "관심", "온열질환 증상 교육, 충분한 수분 섭취, 적절한 휴식",
      TRUE, "기본 수칙 준수 (물, 그늘, 휴식)"
    ))))
    ```

> [!TIP]
> 1행 헤더에 `IF(ROW(A:A)=1, "헤더이름", ...)` 형식으로 ArrayFormula를 작성하면, 현장 작업자가 데이터를 편집하다가 아래 행을 실수로 삭제하더라도 수식이 지워지지 않아 시스템 안정성이 비약적으로 극대화됩니다.

---

## 2. AppSheet 설정 및 직관적 UX 구축 가이드

작업자들이 스마트폰으로 빠르고 오차 없이 현장 상황을 기록하고, 위험 등급을 즉시 확인할 수 있도록 AppSheet 설정 값과 UX 팁을 제시합니다.

### 2-1. Data > Columns 주요 열 설정 테이블

#### 1) '자율점검표' 테이블 설정
*   **통합 구역 관리**: 점검 대상 구역을 별도로 선택하지 않고 모든 구역을 일괄 통합 점검하므로 기존 `측정 장소` 열은 삭제되었습니다.
*   **자율점검 항목들** (13개 세부 점검 항목):
    *   `Type = Enum`, `Input Mode = Buttons`
    *   **Allowed Values**: `적정`, `개선필요`, `해당없음`
    *   **Initial Value**: `"적정"` (보통 정상 상태가 기본값이므로 관리자의 데이터 입력을 최소화하기 위해 기본 탭 선정을 수행합니다.)

#### 2) '체감온도_기록지' 테이블 설정 (실시간 앱 화면 연동형)
구글 시트의 `ArrayFormula`는 데이터가 **서버로 제출된 이후에만 계산**되므로, 작업자가 기온/습도를 입력하는 순간 **스마트폰 앱 화면에서 실시간으로 체감온도와 경보 단계를 시각적으로 확인하기 어렵다는 단점**이 있습니다.
이를 해결하기 위해 AppSheet 내부의 **Virtual Column(가상 열)** 또는 **App Formula**를 병행 사용하는 것이 모바일 앱 개발의 핵심 기법입니다.

*   **기온**: `Type = Decimal`, `Minimum value = 0`, `Maximum value = 50`, `Numeric digits = 1`
*   **습도**: `Type = Number`, `Minimum value = 0`, `Maximum value = 100` (습도는 % 단위의 정수 입력)
*   **체감온도**: `Type = Decimal`
    *   **App Formula**: `[기온] + 0.14 * ([습도] - 50)`
*   **폭염 단계**: `Type = Text`
    *   **App Formula**:
        ```appsheet
        IFS(
          [체감온도] >= 38, "위험",
          [체감온도] >= 35, "경고",
          [체감온도] >= 33, "주의",
          [체감온도] >= 31, "관심",
          TRUE, "정상"
        )
        ```
*   **조치사항**: `Type = Show` (또는 `Text`)
    *   **App Formula**:
        ```appsheet
        IFS(
          [폭염 단계] = "위험", "🚨 매시간 15분 이상씩 또는 2시간 이내 20분 이상 휴식, 긴급조치 외 무더위 시간대 옥외작업 전면 중지",
          [폭염 단계] = "경고", "⚠️ 매시간 15분씩 또는 2시간 이내 20분 이상 휴식, 무더위 시간대 옥외작업 중지, 민감군 옥외작업 제한",
          [폭염 단계] = "주의", "💡 매시간 10분씩 또는 2시간 이내 20분 이상 휴식, 무더위 시간대 옥외작업 단축, 보냉장구 지급",
          [폭염 단계] = "관심", "ℹ️ 온열질환 증상 교육, 충분한 수분 섭취, 적절한 휴식",
          TRUE, "✅ 정상 작업 실시 및 기본 온열질환 예방 수칙 준수"
        )
        ```

---

### 2-2. UX 및 시각화(Format Rules) 설정 가이드

현장에서 경고 상태를 단 0.1초 만에 인지하여 즉각 조치를 취할 수 있도록 시각적인 규칙을 적용합니다.

#### 1) Format Rules를 활용한 직관적 위험 경보 시각화
AppSheet의 **App > Format Rules**에서 아래 규칙을 생성하여 가독성을 극대화합니다.

```
1. [위험] 단계 시각화 Rule
   - Target Column: [폭염 단계], [체감온도]
   - Condition: [폭염 단계] = "위험"
   - Format: 글자 색상 = #FF0000(빨간색), 글자 크기 = 1.3, Bold 처리, 아이콘 = alert-octagon (위험 아이콘)

2. [경고] 단계 시각화 Rule
   - Target Column: [폭염 단계], [체감온도]
   - Condition: [폭염 단계] = "경고"
   - Format: 글자 색상 = #FF6600(주황색), 글자 크기 = 1.2, Bold 처리, 아이콘 = alert-triangle

3. [주의] 단계 시각화 Rule
   - Target Column: [폭염 단계], [체감온도]
   - Condition: [폭염 단계] = "주의"
   - Format: 글자 색상 = #FFCC00(노란색/황금색), Bold 처리, 아이콘 = info

4. [미준수 항목(N)] 빨간색 경고 표시 Rule
   - Target Column: [물_충분한_식수_비치], [그늘_작업장_근처_그늘_확보], [휴식_휴게시간_준수] 등 자율점검표의 6대 항목
   - Condition: [_THIS] = "N"
   - Format: 배경 색상 = #FFEEEE (부드러운 빨간색 배경), 글자 색상 = #CC0000(진한 빨간색), Bold 처리
```

#### 2) UX View 레이아웃 구성
*   **자율점검 Form 뷰**: 
    *   점검 항목들을 여러 페이지로 쪼개기보다, 한 화면에 일목요연하게 표시하는 **`Side-by-side`** 스타일을 추천합니다.
    *   `Show` 컬럼 타입을 활용해 `Section Header`를 생성하고, **"1. 기본 정보"**, **"2. 5대 기본 수칙 점검"**, **"3. 민감군 및 특이사항"** 순서로 구획을 나누어 주면 터치 실수를 방지할 수 있습니다.
*   **체감온도 현황 Dashboard 뷰**:
    *   **좌측 영역**: '체감온도 기록지' 입력 폼 뷰
    *   **우측 영역**: 실시간 측정 데이터들의 Deck 뷰(혹은 Table 뷰)를 배치하여, 다른 장소의 최신 폭염 상태도 실시간으로 한눈에 파악할 수 있도록 결합형 대시보드를 구축합니다.

---

## 3. Google Apps Script(GAS) 실시간 경고 메일 발송 코드

체감온도가 **33℃(주의) 이상**으로 등록될 때 안전보건팀 책임자 및 현장 감독자에게 즉시 동적 디자인이 가미된 HTML 경고 메일을 발송합니다.

### 3-1. AppSheet와 GAS 연동의 중요 핵심 (트랩 방지)
> [!WARNING]
> **초보 개발자가 가장 많이 하는 실수:** 
> AppSheet가 Google Sheets에 데이터를 입력할 때는 Google API를 통과하므로, 스프레드시트의 단순 **`onEdit`** 이나 **`onFormSubmit`**(구글 설문용) 트리거는 **작동하지 않습니다.**
> 
> **최선의 해결책 (2가지 경로):**
> 1.  **[방안 A - 가장 권장됨]** AppSheet의 **Automation Bot** 기능에서 `Call a Script`를 활용해 GAS의 함수를 직접 실행하고 변수를 매개변수(`Arguments`)로 넘기는 방법.
> 2.  **[방안 B]** Google Sheets에 **Installable onChange(변경) 트리거**를 인스톨하여 API에 의한 행 삽입 이벤트(`INSERT_ROW`)를 동적으로 잡아내는 방법.

아래 코드는 **이 두 가지 방안을 모두 지원**하도록 유연하게 작성되었습니다.

---

### 3-2. GAS Alert System 통합 소스 코드

이 코드를 Google Sheets의 **[확장 프로그램] > [Apps Script]**를 클릭해 나오는 에디터 창에 붙여넣기 하면 됩니다.

```javascript
/**
 * 폭염 건강장애 예방 시스템 - 긴급 알림 메일 시스템
 * KOSHA 가이드라인 준수 및 실시간 메일 전송 담당
 */

// =========================================================================
// [설정 값 정의]
// =========================================================================
const MANAGER_EMAIL = "safety_manager@yourcompany.com"; // 🚨 안전보건 책임자 수신 이메일 주소 입력

/**
 * =========================================================================
 * [방법 A] AppSheet Automation 'Call a Script'에서 직접 호출하는 메인 함수
 * AppSheet의 Bot 설정에서 행 데이터를 인수로 직접 매핑하여 넘겨줍니다.
 * =========================================================================
 */
function sendHeatwaveAlertFromAppSheet(location, temperature, humidity, perceivedTemp, stage, action) {
  // 안전 진입 필터링: 33도 미만(정상, 관심) 단계는 자동 패스하고 33도(주의) 이상일 때만 발송
  if (parseFloat(perceivedTemp) < 33) {
    Logger.log(`알림 취소: 체감온도(${perceivedTemp}℃)가 알림 기준치(33℃)보다 낮습니다.`);
    return;
  }
  
  // HTML 이메일 본문 생성
  const htmlBody = buildHtmlBody(location, temperature, humidity, perceivedTemp, stage, action);
  
  // 메일 발송 제목
  const subject = `🚨 [폭염 경보 - ${stage}단계] ${location} 체감온도 ${perceivedTemp}℃ 감지! 즉시 안전 조치 요망`;
  
  try {
    MailApp.sendEmail({
      to: MANAGER_EMAIL,
      subject: subject,
      htmlBody: htmlBody
    });
    Logger.log(`[이메일 발송 성공] 수신자: ${MANAGER_EMAIL}, 장소: ${location}, 체감온도: ${perceivedTemp}℃`);
  } catch (error) {
    Logger.log(`[이메일 발송 실패] 에러 내용: ${error.toString()}`);
  }
}

/**
 * =========================================================================
 * [방법 B] 구글 시트의 Installable onChange 트리거를 사용할 때 실행되는 이벤트 핸들러
 * AppSheet에서 데이터 동기화로 행이 삽입될 때 비동기적으로 이벤트를 포착하여 처리합니다.
 * =========================================================================
 */
function handleSheetChange(e) {
  // 이벤트 데이터 검증 및 행 추가(INSERT_ROW) 조건 확인
  if (!e || e.changeType !== 'INSERT_ROW') return;
  
  // 구글 시트 재계산(ArrayFormula 작동)을 위한 2초 지연 대기
  Utilities.sleep(2000);
  SpreadsheetApp.flush();
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("체감온도_기록지");
  if (!sheet) {
    Logger.log("에러: '체감온도_기록지' 시트를 찾을 수 없습니다.");
    return;
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return; // 헤더만 있는 경우 스킵
  
  // 데이터 로딩 (A:ID, B:기록일시, C:기록자, D:측정 장소, E:기온, F:습도, G:체감온도, H:폭염 단계, I:조치사항)
  // D열(측정장소)부터 I열(조치사항)까지 로드 (4번째 열부터 6개 열 범위)
  const dataRange = sheet.getRange(lastRow, 4, 1, 6);
  const values = dataRange.getValues()[0];
  
  const location = values[0];       // D열: 측정 장소
  const temperature = parseFloat(values[1]); // E열: 기온
  const humidity = parseInt(values[2]);      // F열: 습도
  
  // 만약 시트의 ArrayFormula 계산이 완료되지 않아 공백인 경우, 코드 내에서 실시간 보조 계산 수행 (안전장치)
  let perceivedTemp = values[3];
  if (!perceivedTemp || perceivedTemp === "") {
    perceivedTemp = Math.round((temperature + 0.14 * (humidity - 50)) * 10) / 10;
  } else {
    perceivedTemp = parseFloat(perceivedTemp);
  }
  
  let stage = values[4];
  if (!stage || stage === "") {
    if (perceivedTemp >= 38) stage = "위험";
    else if (perceivedTemp >= 35) stage = "경고";
    else if (perceivedTemp >= 33) stage = "주의";
    else if (perceivedTemp >= 31) stage = "관심";
    else stage = "정상";
  }
  
  let action = values[5];
  if (!action || action === "") {
    const actionMap = {
      "위험": "매시간 15분 이상씩 또는 2시간 이내 20분 이상 휴식, 재난/안전 등 긴급조치 외 무더위 시간대 옥외작업 전면 중지",
      "경고": "매시간 15분씩 또는 2시간 이내 20분 이상 휴식, 무더위 시간대 불가피한 경우 제외 옥외작업 중지, 민감군 옥외작업 제한",
      "주의": "매시간 10분씩 또는 2시간 이내 20분 이상 휴식, 무더위 시간대 옥외작업 단축, 보냉장구 지급",
      "관심": "온열질환 증상 교육, 충분한 수분 섭취, 적절한 휴식"
    };
    action = actionMap[stage] || "기본 수칙 준수 (물, 그늘, 휴식)";
  }
  
  // 체감온도 33도 이상인 주의 단계부터 긴급 경보 메일 발송
  if (perceivedTemp >= 33) {
    sendHeatwaveAlertFromAppSheet(location, temperature, humidity, perceivedTemp, stage, action);
  }
}

/**
 * =========================================================================
 * [보조 함수] 프리미엄 스타일의 HTML 이메일 템플릿 제너레이터
 * 단계별로 경보 색상과 강조도를 동적으로 매핑하여 안전보건팀의 가독성을 높입니다.
 * =========================================================================
 */
function buildHtmlBody(location, temperature, humidity, perceivedTemp, stage, action) {
  // 단계별 메인 테마 색상 지정
  let headerColor1 = "#ff9900"; // 주의 (황금색)
  let headerColor2 = "#e68a00";
  let badgeColor = "#ffcc00";
  let textColor = "#b38600";
  
  if (stage === "경고") {
    headerColor1 = "#ff6600"; // 경고 (주황색)
    headerColor2 = "#cc5200";
    badgeColor = "#ff6600";
    textColor = "#e65c00";
  } else if (stage === "위험") {
    headerColor1 = "#e60000"; // 위험 (강렬한 빨간색)
    headerColor2 = "#990000";
    badgeColor = "#cc0000";
    textColor = "#cc0000";
  }
  
  const now = new Date();
  const formattedTime = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

  return `
    <div style="font-family: 'Malgun Gothic', '맑은 고딕', Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08);">
      <!-- 헤더 배너: 경보 위험도에 따른 동적 그라데이션 컬러 적용 -->
      <div style="background: linear-gradient(135deg, ${headerColor1}, ${headerColor2}); color: white; padding: 25px 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -1px; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">🚨 온열질환 예방 긴급 안전경보</h1>
        <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.95; font-weight: 300;">KOSHA 가이드에 따른 근로자 보건 안전조치를 즉시 시행하십시오.</p>
      </div>
      
      <!-- 본문 영역 -->
      <div style="padding: 30px 24px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #1a202c; line-height: 1.7; margin-top: 0; margin-bottom: 20px;">
          안전보건관리 책임자님,<br>
          현장 열환경 모니터링 시스템 감지 결과, <span style="background-color: #fef3c7; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #d97706;">${location}</span>의 체감온도가 
          <strong>${perceivedTemp}℃</strong>를 돌파하여 <span style="color: ${textColor}; font-weight: 900; font-size: 20px; text-decoration: underline;">[${stage}]</span> 단계에 진입하였습니다.
        </p>
        
        <!-- 실시간 계측 데이터 테이블 -->
        <table style="width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 14px; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
              <th style="padding: 12px 16px; text-align: left; color: #475569; font-weight: 600;">구분</th>
              <th style="padding: 12px 16px; text-align: left; color: #475569; font-weight: 600;">실측/계산 값</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 12px 16px; color: #64748b;">측정 장소</td>
              <td style="padding: 12px 16px; font-weight: bold; color: #1e293b;">${location}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 12px 16px; color: #64748b;">현재 측정 기온</td>
              <td style="padding: 12px 16px; font-weight: 600; color: #1e293b;">${temperature} ℃</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 12px 16px; color: #64748b;">현재 측정 습도</td>
              <td style="padding: 12px 16px; font-weight: 600; color: #1e293b;">${humidity} %</td>
            </tr>
            <tr style="border-bottom: 1px solid #cbd5e1; background-color: #fef2f2;">
              <td style="padding: 12px 16px; color: #dc2626; font-weight: bold;">산출 체감온도</td>
              <td style="padding: 12px 16px; color: #dc2626; font-weight: 900; font-size: 18px;">${perceivedTemp} ℃</td>
            </tr>
            <tr style="background-color: #fafafa;">
              <td style="padding: 12px 16px; color: #64748b;">위험 경보 등급</td>
              <td style="padding: 12px 16px;">
                <span style="display: inline-block; color: white; background-color: ${badgeColor}; font-weight: bold; padding: 4px 14px; border-radius: 20px; font-size: 13px; text-shadow: 0 1px 1px rgba(0,0,0,0.15);">
                  ${stage} 단계
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        
        <!-- KOSHA 가이드라인 현장 핵심 수칙 조치 권고 박스 -->
        <div style="background-color: #f8fafc; border-left: 5px solid ${badgeColor}; padding: 20px; border-radius: 6px; margin: 25px 0;">
          <h3 style="margin: 0 0 10px 0; color: #1e293b; font-size: 16px; font-weight: bold; display: flex; align-items: center;">
            📢 현장 안전 조치 의무사항 (KOSHA 표준)
          </h3>
          <p style="margin: 0; font-size: 15px; color: #334155; line-height: 1.7; font-weight: 700; word-break: keep-all;">
            ${action}
          </p>
        </div>
        
        <!-- 즉시 대응 가이드라인 체크리스트 -->
        <div style="border: 1px dashed #cbd5e1; padding: 15px; border-radius: 6px; margin-top: 15px;">
          <h4 style="margin: 0 0 8px 0; font-size: 13px; color: #475569; font-weight: bold;">⚠️ 관리책임자 행동 요령:</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #64748b; line-height: 1.6;">
            <li>해당 구역 근로자들에게 체감온도 및 위험 단계를 즉시 방송이나 구두로 전파하십시오.</li>
            <li>그늘막 내 얼음물 및 보냉장구가 신속히 보급될 수 있도록 보급 담당자를 독려하십시오.</li>
            <li>민감군 근로자(고령자, 유소견자 등)는 안전한 실내 구역으로 전환 배치하십시오.</li>
            <li>의식 불명 등 긴급 온열장애 환자 발생 시 즉시 119 구급대를 호출하고 응급 처치를 시행하십시오.</li>
          </ul>
        </div>
      </div>
      
      <!-- 푸터 영역 -->
      <div style="background-color: #f8fafc; color: #94a3b8; text-align: center; padding: 20px; font-size: 12px; border-top: 1px solid #e2e8f0; line-height: 1.5;">
        <strong>수신 일시:</strong> ${formattedTime}<br>
        본 메일은 [폭염 건강장애 예방 모니터링 시스템]에 의해 자동 생성된 보안 메일입니다.<br>
        사내 산업안전보건위원회 의결에 의거, 무단 배포를 금합니다.
      </div>
    </div>
  `;
}
```

---

### 3-3. 구글 앱스 스크립트(GAS) 트리거 설정 가이드

체감온도가 실시간으로 감지되어 메일이 가도록 설정하는 최적의 방법은 다음과 같습니다.

#### 1) 방법 A 적용 시 (AppSheet Automation 연동 - 가장 추천)
1. AppSheet 관리 콘솔(`AppSheet Editor`)에 접속합니다.
2. 좌측 메뉴에서 **`Automation` > `Bots`**로 이동해 **`Create a new bot`**을 클릭합니다.
3. Bot의 트리거 조건을 다음과 같이 설정합니다.
   * **Event**: `Data Change` -> `Add Only` -> Table: `체감온도_기록지`
4. 실행될 Task를 추가하고 **`Run a Task`**를 선택합니다.
5. Task 설정을 다음과 같이 변경합니다.
   * **Task Category**: `Call a script`
   * **Table name**: `체감온도_기록지`
   * **Script**: 생성한 GAS 프로젝트 선택
   * **Function Name**: `sendHeatwaveAlertFromAppSheet`
   * **Function Arguments (인수 매핑)**:
     * `location`: `[측정 장소]`
     * `temperature`: `[기온]`
     * `humidity`: `[습도]`
     * `perceivedTemp`: `[체감온도]`
     * `stage`: `[폭염 단계]`
     * `action`: `[조치사항]`
6. 우측 상단의 `Save`를 눌러 활성화합니다.

#### 2) 방법 B 적용 시 (Google Sheets Installable 트리거 연동)
1. Apps Script 에디터 화면의 왼쪽 메뉴에서 시계 아이콘(**트리거**)을 클릭합니다.
2. 우측 하단의 **[트리거 추가]** 버튼을 클릭합니다.
3. 다음과 같이 설정 값을 지정합니다.
   * **실행할 함수 선택**: `handleSheetChange`
   * **실행할 배포 선택**: `기본값(Head)`
   * **이벤트 소스 선택**: `스프레드시트에서`
   * **이벤트 유형 선택**: **`변경 시`** (※ 주의: *'수정 시'*가 아닌 ***'변경 시(onChange)'***로 설정해야 AppSheet API를 통한 신규 데이터 삽입 이벤트가 포착됩니다.)
4. 저장 버튼을 누르고, 구글 권한 인증 팝업이 나타나면 `고급` -> `이동(안전하지 않음)`을 선택하여 메일 전송 및 시트 접근 권한을 승인합니다.
