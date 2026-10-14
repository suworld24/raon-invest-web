# 라온's 투자 (raon-invest-web)

개인 투자 기록 + 시장 분석 웹앱입니다. Google 계정으로 로그인하면 기록이 내 계정(DB)에 저장됩니다.

| 화면 | 기능 |
|---|---|
| 포트폴리오 | 여러 계좌, 매매·입출금·배당 기록, 자산 구성 도넛, 섹터 비중, 원화/달러 전환, 금액 숨기기, 과거 잔고 조회, 월별 보정 수익률(Modified Dietz), CSV |
| 기업 스크리너 | 미국 상장 약 6,600개 종목, 업종·거래소·시총·가격·등락률 필터, 정렬, 수익률(1·3·6·12개월·YTD), 관심종목 ★, 조건 저장, 최대 5개 기업 비교, CSV |
| 섹터 퍼포먼스 | 내가 만든 섹터(종목 묶음) 동일가중 수익률, RRG(상대강도·모멘텀) 차트와 타임라인, 섹터 추가·편집, 리스트 백업, CSV |
| 랭킹 테이블 | 미국/한국 산업 ETF·대형주의 주간·월간 수익률 순위와 순위 변동, 색상 표시 |
| 실적발표 캘린더 | 내 일정 등록 + Nasdaq 실적 발표일 자동 표시(관심·보유 종목 / 시총 $10B 이상) |
| 참고자료 | 링크·메모 보관, 태그, 검색, 고정 |
| 공통 | 라이트/다크, 최근 변경 되돌리기, 내 기록 백업/불러오기(JSON) |

시세 자료: Nasdaq 공개 종목 목록·실적 일정, Yahoo Finance 차트 시세 (실시간 체결가 아님).

---

## 배포하기 (Render · 주소: https://raon-invest-web.onrender.com)

준비물: GitHub 계정, Render 계정, Google Cloud 계정(구글 계정이면 됨), 무료 Postgres (Neon 추천)

### 1. GitHub에 올리기
1. https://github.com/new 에서 저장소 이름을 `raon-invest-web`로 만듭니다 (Private 가능).
2. 저장소 화면의 **uploading an existing file**을 눌러 이 폴더 안의 파일을 전부 끌어다 놓고 Commit 합니다.
   (`node_modules`, `data` 폴더는 올리지 않습니다.)

### 2. 데이터베이스 만들기 (Neon 무료, 기간 제한 없음)
1. https://neon.tech 가입 → New Project.
2. 만들어진 **Connection string** (`postgresql://...`)을 복사해 둡니다. 이것이 `DATABASE_URL`입니다.

> Render 무료 Postgres도 쓸 수 있지만 무료 DB는 일정 기간 후 만료되므로 Neon을 추천합니다.

### 3. Render에 웹 서비스 만들기
1. https://dashboard.render.com → **New → Web Service** → GitHub 저장소 `raon-invest-web` 연결.
2. 설정
   - Name: **raon-invest-web** ← 이 이름이 주소가 됩니다
   - Runtime: Node · Build Command: `npm install` · Start Command: `npm start`
   - Instance Type: Free
3. Environment Variables
   | 키 | 값 |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | 2단계에서 복사한 값 |
   | `SESSION_SECRET` | 아무 긴 임의 문자열 (Generate 버튼 사용 가능) |
   | `GOOGLE_CLIENT_ID` | 4단계에서 발급 |
   | `GOOGLE_CLIENT_SECRET` | 4단계에서 발급 |
   | `ALLOWED_EMAILS` | (선택) 로그인 허용할 이메일, 쉼표로 구분. 비우면 누구나 가입 가능 |
4. Create Web Service. 이름이 이미 쓰이고 있으면 주소 뒤에 글자가 붙을 수 있습니다.

### 4. Google 로그인 설정
1. https://console.cloud.google.com → 새 프로젝트 만들기.
2. **API 및 서비스 → OAuth 동의 화면**: 외부(External), 앱 이름 `라온's 투자`, 이메일 입력 후 저장. 테스트 사용자에 본인 Gmail 추가(또는 앱 게시).
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: 웹 애플리케이션
   - 승인된 JavaScript 원본: `https://raon-invest-web.onrender.com`
   - 승인된 리디렉션 URI: `https://raon-invest-web.onrender.com/auth/google/callback`
4. 발급된 클라이언트 ID / 보안 비밀을 Render 환경변수에 넣고 저장하면 자동 재배포됩니다.

### 참고
- Render 무료 플랜은 15분간 접속이 없으면 잠들고, 다음 접속 때 30초~1분 정도 깨어나는 시간이 걸립니다.
- 첫 화면에서 종목 목록·시세를 처음 받아올 때 몇 초 걸립니다(이후 서버에 캐시).

---

## 내 PC에서 실행하기 (선택)
Node.js 20 이상 필요.
```bash
npm install
DEV_LOGIN=1 npm start        # Windows PowerShell: $env:DEV_LOGIN=1; npm start
```
http://localhost:3000 → "로컬 테스트로 들어가기". `DATABASE_URL`이 없으면 `data/local-db.json`에 저장합니다.

## 구조
```
server.js          Express 서버, Google 로그인, API
lib/market.js      시세 수집 + 캐시 (Nasdaq, Yahoo)
lib/store.js       Postgres / 로컬 파일 저장소
public/            화면 (login.html, app.html, app.css, js/*)
render.yaml        Render 블루프린트 (Render DB 사용 시)
```
