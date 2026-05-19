# 🌡️ KOSHA 폭염 예방 모바일 스마트 앱

> 안전보건공단(KOSHA) 「온열질환 예방 가이드」를 100% 반영한 현장 보건관리자용 폭염 건강장애 예방 시스템

[![KOSHA](https://img.shields.io/badge/KOSHA-100%25%20%EC%A4%80%EC%88%98-success)](https://www.kosha.or.kr)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen)](https://buminhealth.github.io/buminhealth-temporature/)
[![License](https://img.shields.io/badge/license-Internal-blue.svg)]()

🔗 **운영 URL**: https://buminhealth.github.io/buminhealth-temporature/

---

## 📌 시스템 개요

부민병원그룹 시설관리·영양·폐수처리 등 폭염 노출 가능성이 높은 작업장의 **체감온도 실시간 측정**, **5대 기본수칙 자율점검**, **온열질환자 응급조치 체계**를 통합 관리하는 모바일 우선(Mobile-first) 웹 애플리케이션입니다.

### 적용 법령·가이드라인
- 산업안전보건법 시행규칙 제566조(휴게시설), 제571조의2(폭염 노출 작업 시 조치)
- 안전보건공단 「온열질환 예방 가이드」(2024 개정)
- 기상청 여름철 약식 체감온도 산출 공식: `체감온도(℃) = 기온 + 0.14 × (습도 - 50)`

---

## 🎯 핵심 기능

### 1. 실시간 체감온도 기록 (1일 2회: 오전 10시 / 오후 2시)
- 측정 장소 5개 지정 + 기타 직접 입력
- 기온·습도 슬라이더 입력 → **체감온도 자동 산출**
- 5단계 폭염 구분 시각화
- 단계별 KOSHA 의무 관리조치 자동 표시
- **전자 서명(Signature Pad) 캔버스** 내장

### 2. 폭염 5대 기본수칙 자율점검표 (주 1회)
- **13개 세부 점검 항목** (적정 / 개선필요 / 해당없음 3단계 평가)
- 1) 물 · 2) 바람·그늘 · 3) 휴식 · 4) 보냉장구 · 5) 응급조치 · 6) 그 외 예방조치
- 보완조치 사항 자유 기술

### 3. 기록 보관소
- **체감기록 미제출 누락 경보 위젯** (실시간 모니터링)
- 날짜·장소별 검색 및 필터링
- 선택 항목 일괄 PDF 출력 기능

---

## 🌡️ KOSHA 폭염 5단계 분류 기준

| 단계 | 체감온도 | 색상 | 핵심 조치 |
|:---:|:---:|:---:|:---|
| 🔵 정상 | ~30.9℃ | Blue | 기본 수칙 준수 (물·그늘·휴식) |
| 🟦 관심 | 31℃~ | Cyan | 온열질환 증상 교육, 충분한 수분 섭취 |
| 🟡 주의 | 33℃~ | Yellow | 매시간 10분씩 또는 2시간 이내 20분 휴식, 보냉장구 지급 |
| 🟠 경고 | 35℃~ | Orange | 매시간 15분씩 휴식, 무더위 시간대 옥외작업 중지 |
| 🔴 위험 | 38℃~ | Red | 매시간 15분 이상 휴식, **긴급조치 외 옥외작업 전면 중지** |

---

## 🛠️ 기술 스택

| 구분 | 사용 기술 |
|:---:|:---|
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6+) |
| Font | Pretendard (CDN) |
| Icons | Font Awesome 6.4 (CDN) |
| QR Code | api.qrserver.com (외부 API) |
| Hosting | GitHub Pages (정적 호스팅) |
| Database 연동 (선택) | Google Sheets + AppSheet + Google Apps Script (`DESIGN.md` 참조) |

---

## 📂 파일 구조

```
buminhealth-temporature/
├── index.html       # 메인 UI (모바일 셸 + 데스크톱 QR 패널)
├── style.css        # 다크 글래스 테마, 모바일 반응형
├── app.js           # 비즈니스 로직 (1,100+ 라인)
├── DESIGN.md        # 백엔드 자동화 설계서 (GAS / AppSheet 연동)
├── .gitignore       # Git 제외 파일 규칙
└── README.md        # 본 문서
```

---

## 🚀 사용 방법

### 즉시 사용 (GitHub Pages 배포 완료 시)
1. PC 브라우저로 https://buminhealth.github.io/buminhealth-temporature/ 접속
2. 좌측 **QR 코드를 스마트폰으로 스캔** → 모바일 화면 진입
3. 모바일에서 측정값 입력 → 전자 서명 → 제출
4. 보관소 탭에서 미제출 누락 모니터링 및 일괄 출력

### 로컬 실행
```bash
# 별도 빌드 도구 불필요 - 정적 파일만 호스팅
python3 -m http.server 8080
# 또는
npx serve .
```

---

## 🔗 백엔드 자동화 연동 (선택, `DESIGN.md` 참조)

현재 버전은 클라이언트 사이드 데모 데이터로 동작합니다. 운영 환경 구축 시 다음 단계가 권장됩니다.

1. **Google Sheets** DB 구성 (자율점검표 / 체감온도_기록지)
2. **AppSheet** 폼 뷰 연동 (Virtual Column으로 실시간 체감온도 계산)
3. **Google Apps Script** 자동 알림 메일 (체감온도 33℃ 이상 시 안전보건 책임자에게 HTML 경보 메일 발송)
4. **AppSheet Automation Bot**: `Data Change(Add Only)` → `Call a Script` 트리거 설정

---

## 📋 측정 장소 (현재 등록)

- 본관 지하2층 기계실
- 시설 관리팀 작업실
- 신관 지하1층 기계실
- 폐수처리장
- 본관 10층 영양팀
- 기타 작업장 (직접 입력)

---

## 📝 변경 이력

| 버전 | 날짜 | 변경 사항 |
|:---:|:---:|:---|
| v1.2.0 | 2026-05 | 13개 세부 점검 항목 / 3단계 평가 / 전자서명 / 누락경보 |
| v1.0.0 | 초기 | Y/N 평가 기반 6대 항목 점검표 |

---

## 🏥 운영 기관

**부민병원그룹 (인당의료재단)** — 기획경영팀
- 부산부민병원 / 해운대부민병원 / 서울부민병원 / 구포부민병원

---

## ⚖️ 라이선스

본 시스템은 부민병원그룹 내부 사용 목적으로 개발되었습니다. 외부 공개·배포 시 기획경영팀 사전 협의가 필요합니다.
