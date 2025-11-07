// server.js
const express = require("express");
// const { MongoClient } = require("mongodb"); // 추후 MongoDB 사용 시
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const archiver = require("archiver");
const session = require("express-session");

const app = express();

// Railway 프록시 신뢰 설정
app.set('trust proxy', 1);

app.use(express.json());

// CORS 설정 (세션 쿠키 전송을 위해 필요)
app.use((req, res, next) => {
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/');
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// 세션 설정 (로컬/Railway 구분)
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  secret: process.env.SESSION_SECRET || 'eltrokorea-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid',
  cookie: {
    secure: isProduction, // 로컬: false, Railway: true
    httpOnly: true,
    maxAge: 4 * 60 * 60 * 1000, // 4시간
    sameSite: isProduction ? 'none' : 'lax', // 로컬: lax, Railway: none
    path: '/',
    domain: undefined // 도메인 제한 없음
  },
  proxy: isProduction // Railway 프록시 사용
}));

// 비밀번호 설정
const passwords = {
  "EK": "eltrokorea9",
  "TF": "treofan1",
  "SM": "sungmoon2",
  "NT": "nuintek3"
};

// 인증 미들웨어
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/');
};

// 로그인 API
app.post('/api/login', (req, res) => {
  const { section, password } = req.body;
  
  console.log('Login attempt:', { section, hasPassword: !!password });
  console.log('Current session:', req.session);
  
  if (passwords[section] && password === passwords[section]) {
    req.session.authenticated = true;
    req.session.section = section;
    
    console.log('Session set:', { authenticated: req.session.authenticated, section: req.session.section });
    console.log('Session ID:', req.sessionID);
    console.log('Cookie will be set:', req.session.cookie);
    
    // 세션 저장 후 응답
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ success: false, message: '세션 저장 실패' });
      }
      
      console.log('Session saved successfully');
      console.log('Session cookie:', req.session.cookie);
      
      const sectionPages = {
        "EK": "eltrokorea9.html",
        "SM": "sungmoon.html",
        "NT": "nuintek.html",
        "TF": "treofan.html"
      };
      const targetPage = sectionPages[section] || section + ".html";
      
      // 응답 헤더에 쿠키가 포함되는지 확인
      const setCookieHeader = res.getHeader('Set-Cookie');
      console.log('Set-Cookie header:', setCookieHeader);
      
      // 서버 사이드 리다이렉트로 변경
      res.json({ 
        success: true, 
        section: section,
        redirect: targetPage,
        sessionId: req.sessionID,
        cookieSet: !!setCookieHeader
      });
    });
  } else {
    res.status(401).json({ success: false, message: '비밀번호가 틀렸습니다.' });
  }
});

// 로그아웃 API
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 인증 상태 확인 API
app.get('/api/auth/status', (req, res) => {
  res.json({ 
    authenticated: req.session && req.session.authenticated || false,
    section: req.session && req.session.section || null
  });
});

// HTML 파일 접근 보호 미들웨어
app.use((req, res, next) => {
  // index.html은 항상 허용
  if (req.path === '/' || req.path === '/index.html') {
    return next();
  }
  
  // API 엔드포인트는 허용
  if (req.path.startsWith('/api/')) {
    return next();
  }
  
  // 정적 파일 (이미지, CSS, JS 등)은 허용
  if (!req.path.endsWith('.html')) {
    return next();
  }
  
  // HTML 파일은 인증 필요
  if (req.session && req.session.authenticated) {
    return next();
  } else {
    console.log('Unauthorized access attempt to:', req.path, 'Session:', req.session);
    return res.redirect('/');
  }
});

// 정적 파일 제공 (HTML 제외)
app.use(express.static(__dirname, {
  setHeaders: (res, path) => {
    // HTML 파일은 위 미들웨어에서 처리되므로 여기서는 제외
  }
}));

// 저장 경로 설정 (환경 변수로 로컬/Railway 구분)
// 로컬: __dirname 사용 (컴퓨터 하드)
// Railway: /uploads 사용 (Volume)
const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// uploads 폴더 구조 생성
const createUploadStructure = () => {
  const basePath = UPLOAD_DIR;
  const modes = ['NT', 'SM'];
  const categories = ['OrderID', 'OrderNO', 'DeliveryNO'];
  
  modes.forEach(mode => {
    categories.forEach(category => {
      fs.mkdirSync(path.join(basePath, mode, category), { recursive: true });
    });
  });
  
  // 세무자료 폴더 구조 생성 (년도별로 동적 생성되므로 기본 구조만 생성)
  fs.mkdirSync(path.join(basePath, '세무자료'), { recursive: true });
  
  // JSON 데이터 저장 폴더 생성 (Volume에 저장하기 위해)
  fs.mkdirSync(path.join(DATA_DIR), { recursive: true });
};

// 서버 시작 시 폴더 구조 생성
createUploadStructure();

// multer 설정 - 메모리 저장소 사용
const upload = multer({ 
  storage: multer.memoryStorage(),
  preservePath: true,
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('허용되지 않는 파일 형식입니다.'));
    }
  }
});

// 데이터 파일 경로 설정 (JSON과 PDF 동일한 방식으로 저장)
const DATA_FILE = path.join(DATA_DIR, "priceData.json");
const ORDER_DATA_FILE = path.join(DATA_DIR, "orderData.json");
const CREDIT_NOTE_FILE = path.join(DATA_DIR, "creditnote.json");
const TRANSFER_DATA_FILE = path.join(DATA_DIR, "transfer.json");
const CALENDAR_DATA_FILE = path.join(DATA_DIR, "calendar.json");
const ACCOUNTING_DATA_FILE = path.join(DATA_DIR, "accounting.json");

// 서버 메모리 저장 변수들 (MongoDB 대신 사용)
let priceStore = {};
let orderStore = [];
let calendarStore = {};
let creditNoteStore = [];
let transferStore = { transfers: [], payrolls: [], deposits: [] };
let accountingStore = { balance: [] };

// priceData.json 정렬 함수
function sortPriceData(priceData) {
  const modeOrder = { 'EK': 1, 'NT': 2, 'SM': 3 };
  
  // 모드 순서로 정렬된 키 가져오기
  const sortedModes = Object.keys(priceData)
    .sort((a, b) => (modeOrder[a] || 999) - (modeOrder[b] || 999));
  
  // 각 모드별로 정렬
  const result = {};
  sortedModes.forEach(mode => {
    const modeData = priceData[mode];
    
    // 년도별 정렬 (최신 년도 위로)
    const sortedYears = Object.keys(modeData)
      .sort((a, b) => parseInt(b) - parseInt(a));
    
    const sortedModeData = {};
    sortedYears.forEach(year => {
      // 월별 정렬 (최신 월 위로)
      const sortedMonths = Object.keys(modeData[year])
        .sort((a, b) => parseInt(b) - parseInt(a));
      
      const sortedYearData = {};
      sortedMonths.forEach(month => {
        // PHD 오름차순 정렬
        sortedYearData[month] = modeData[year][month]
          .sort((a, b) => a.phd - b.phd);
      });
      
      sortedModeData[year] = sortedYearData;
    });
    
    result[mode] = sortedModeData;
  });
  
  // 원본 객체 업데이트
  Object.keys(priceData).forEach(key => delete priceData[key]);
  Object.assign(priceData, result);
}

// orderData 정렬 함수 - 주문 레벨 정렬 + 아이템 정렬
function sortOrderStore(orders) {
  // 모드 우선순위 함수
  const getModePriority = (mode) => {
    if (mode === 'NT') return 1;
    if (mode === 'SM-B' || mode === 'SM-C') return 2;
    return 0;
  };
  
  // 날짜 파싱 함수
  const parseOrderDate = (orderDate) => {
    if (!orderDate) return 0;
    const dateParts = orderDate.split('.');
    if (dateParts.length === 3) {
      const year = parseInt(dateParts[0]) || 0;
      const month = parseInt(dateParts[1]) || 0;
      const day = parseInt(dateParts[2]) || 0;
      return year * 10000 + month * 100 + day;
    }
    return 0;
  };
  
  return orders.map(order => {
    // 아이템 정렬 (rowNumber 순)
    if (order.items) {
      order.items.sort((a, b) => {
        const rowA = parseInt(a.rowNumber) || 0;
        const rowB = parseInt(b.rowNumber) || 0;
        return rowA - rowB;
      });
    }
    
    return order;
  }).sort((a, b) => {
    // 모드 우선순위로 정렬 (NT → SM)
    const modePriorityA = getModePriority(a.mode);
    const modePriorityB = getModePriority(b.mode);
    
    if (modePriorityA !== modePriorityB) {
      return modePriorityA - modePriorityB;
    }
    
    // 모드가 같으면 날짜로 정렬 (예전 날짜가 먼저)
    const dateA = parseOrderDate(a.orderDate);
    const dateB = parseOrderDate(b.orderDate);
    return dateA - dateB;
  });
}

// 캘린더 데이터 정렬 함수 (년도-월-일 오름차순)
function sortCalendarData(calendarData) {
  if (!calendarData || !calendarData.events) {
    return calendarData;
  }
  
  const sortedEvents = {};
  
  // 년도별로 정렬 (오름차순)
  const sortedYears = Object.keys(calendarData.events).sort((a, b) => {
    return parseInt(a) - parseInt(b);
  });
  
  sortedYears.forEach(year => {
    const yearData = calendarData.events[year];
    const sortedMonths = {};
    
    // 월별로 정렬 (오름차순)
    const monthKeys = Object.keys(yearData).sort((a, b) => {
      return parseInt(a) - parseInt(b);
    });
    
    monthKeys.forEach(month => {
      const monthData = yearData[month];
      const sortedDays = {};
      
      // 일별로 정렬 (오름차순)
      const dayKeys = Object.keys(monthData).sort((a, b) => {
        return parseInt(a) - parseInt(b);
      });
      
      dayKeys.forEach(day => {
        sortedDays[day] = monthData[day];
      });
      
      sortedMonths[month] = sortedDays;
    });
    
    sortedEvents[year] = sortedMonths;
  });
  
  return {
    ...calendarData,
    events: sortedEvents
  };
}

// 서버 재시동 시 하드 JSON으로 서버 메모리 동기화
function syncFromHardDrive() {
  // 파일 로드 헬퍼 함수
  const loadJsonFile = (filePath, defaultValue, name) => {
    try {
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        console.log(`Loaded ${name} from ${filePath}`);
        return data;
      } else {
        console.log(`${name} file not found: ${filePath}, using default value`);
        return defaultValue;
      }
    } catch (error) {
      console.error(`Error loading ${name} from ${filePath}:`, error.message);
      return defaultValue;
    }
  };
  
  try {
  // 1. Price Data 동기화
  priceStore = loadJsonFile(DATA_FILE, {}, "Price Data");
  
  // 2. Order Data 동기화
  orderStore = loadJsonFile(ORDER_DATA_FILE, [], "Order Data");
  if (orderStore.length > 0) {
    orderStore = sortOrderStore(orderStore);
  }
  
  // 3. Calendar Data 동기화
    calendarStore = loadJsonFile(CALENDAR_DATA_FILE, {}, "Calendar Data");
  
    // 4. Credit Note Data 동기화
  creditNoteStore = loadJsonFile(CREDIT_NOTE_FILE, [], "Credit Note Data");
  
  // 5. Transfer Data 동기화
  transferStore = loadJsonFile(TRANSFER_DATA_FILE, { transfers: [], payrolls: [], deposits: [] }, "Transfer Data");
    
    // 6. Accounting Data 동기화
    accountingStore = loadJsonFile(ACCOUNTING_DATA_FILE, { balance: [] }, "Accounting Data");
    if (!accountingStore.balance) {
      accountingStore.balance = [];
    }
  } catch (error) {
    console.error('Error in syncFromHardDrive:', error);
    throw error;
  }
}

// 서버 시작 시 동기화 실행
console.log('Server initialization started...');
try {
  console.log('Starting data synchronization...');
  syncFromHardDrive();
  console.log('Data synchronization completed');
  } catch (error) {
  console.error('Error during data synchronization:', error);
  // 에러가 발생해도 서버는 계속 실행되도록 함
}

console.log('Starting Express server...');

// 헬스체크 엔드포인트 (Railway 헬스체크용)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

// 루트 경로 (Railway 헬스체크용)
app.get("/", (req, res) => {
  res.status(200).json({ status: "ok", message: "EltroKorea API Server" });
});

//===================================================
// pricedata.json API 모음
//===================================================

// GET /api/price => 서버 메모리에서 조회
app.get("/api/price", (req, res) => {
  try {
    res.json(priceStore);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read price data' });
  }
});

// POST /api/price => 가격 데이터 저장/업데이트
app.post("/api/price", (req, res) => {
  try {
    const { mode, year, month, data } = req.body;
    
    // 객체 구조 생성 헬퍼 함수
    const ensurePriceStructure = (mode, year, month = null) => {
      if (!priceStore[mode]) priceStore[mode] = {};
      if (!priceStore[mode][year]) priceStore[mode][year] = {};
      if (month && !priceStore[mode][year][month]) priceStore[mode][year][month] = [];
    };
    
    // 기본 저장 로직
    if (mode && year && month && Array.isArray(data)) {
      // 객체 구조만 생성 (배열은 바로 교체하므로 불필요)
      if (!priceStore[mode]) priceStore[mode] = {};
      if (!priceStore[mode][year]) priceStore[mode][year] = {};
      
      // 데이터 직접 저장 (불필요한 map 제거)
      priceStore[mode][year][month] = data;
      
      // 전체 정렬 (필요시)
      sortPriceData(priceStore);
      fs.writeFileSync(DATA_FILE, JSON.stringify(priceStore, null, 2), "utf8");
      
      return res.json({ 
        success: true,
        message: "Price data saved successfully",
        mode: mode,
        year: year,
        month: month
      });
    }
    
    // 개별 가격 업데이트 로직 (ADD버튼)
    if (mode && year && month && req.body.phd !== undefined && req.body.price !== undefined) {
      const { phd, price } = req.body;
      
      // 객체 구조 생성
      ensurePriceStructure(mode, year, month);
      
      // 기존 데이터에서 해당 PHD 찾기
      const existingIndex = priceStore[mode][year][month].findIndex(item => item.phd === phd);
      
      const newItem = {
        phd: phd,
        price: parseFloat(price).toFixed(2)
      };
      
      if (existingIndex !== -1) {
        // 기존 데이터 업데이트
        priceStore[mode][year][month][existingIndex] = newItem;
      } else {
        // 새 데이터 추가 - PHD 순서로 정렬하여 삽입
        const insertIndex = priceStore[mode][year][month].findIndex(item => item.phd > phd);
        
        if (insertIndex !== -1) {
          priceStore[mode][year][month].splice(insertIndex, 0, newItem);
        } else {
          priceStore[mode][year][month].push(newItem);
        }
      }
      
      // 파일에 저장
      fs.writeFileSync(DATA_FILE, JSON.stringify(priceStore, null, 2), "utf8");
      
      return res.json({
        success: true,
        message: "Individual price updated successfully",
        mode: mode,
        year: year,
        month: month,
        phd: phd,
        price: price
      });
    }
    
    // 가격 히스토리 업데이트 로직 (ADD버튼)
    if (mode && year && data && !month) {
      ensurePriceStructure(mode, year);
      
      if (Array.isArray(data)) {
        data.forEach(item => {
          const monthKey = item.month.toString();
          ensurePriceStructure(mode, year, monthKey);
          
          const existingIndex = priceStore[mode][year][monthKey].findIndex(existingItem => 
            existingItem.phd === item.phd
          );
          
          const newItem = {
            phd: item.phd,
            price: parseFloat(item.price).toFixed(2)
          };
          
          if (existingIndex >= 0) {
            priceStore[mode][year][monthKey][existingIndex] = newItem;
          } else {
            const insertIndex = priceStore[mode][year][monthKey].findIndex(existingItem => 
              existingItem.phd > item.phd
            );
            
            if (insertIndex >= 0) {
              priceStore[mode][year][monthKey].splice(insertIndex, 0, newItem);
            } else {
              priceStore[mode][year][monthKey].push(newItem);
            }
          }
        });
      }
      
      // 정렬 추가
      sortPriceData(priceStore);
      
      fs.writeFileSync(DATA_FILE, JSON.stringify(priceStore, null, 2));
      
      return res.json({ 
        success: true, 
        message: `${mode} 모드 ${year}년 가격 데이터가 성공적으로 업데이트되었습니다.`,
        mode: mode,
        year: year
      });
    }
    
    return res.status(400).json({ error: "Invalid request body" });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Failed to save price data' 
    });
  }
});



//===================================================
// orderData.json API 모음
//===================================================
// GET /api/orders => 서버 메모리에서 조회
// 통합된 Orders API - 모든 Order 관련 기능 처리
app.get("/api/orders", (req, res) => {
  try {
    const queryParams = req.query;
    
    
    // 서버 메모리에서 데이터 읽기 (다른 API와 일관성 유지)
    let orderData = orderStore;
    
    // 1. 다음 Order 번호 생성 요청
    if (queryParams.nextOrderNo === 'true') {
      let orderMode = queryParams.mode || 'EK';
      
      // 페이지별 접두사 설정
      if (queryParams.pageType === 'NT' || queryParams.page === 'NT') {
        orderMode = 'EK';
      } else if (queryParams.pageType === 'SMB' || queryParams.page === 'SMB' || 
                 queryParams.pageType === 'SMC' || queryParams.page === 'SMC') {
        orderMode = 'SM';
      }
      
      const currentYear = new Date().getFullYear();
      
      let maxOrderNo = 0;
      
      // orderData에서 최대 Order 번호 찾기
      orderData.forEach(order => {
        if (order.orderNo && order.orderNo.startsWith(`${orderMode}-${currentYear}-`)) {
          const cleanOrderNo = order.orderNo.replace(/\(C\)$/, '');
          const match = cleanOrderNo.match(new RegExp(`${orderMode}-${currentYear}-(\\d+)`));
          if (match) {
            const orderNum = parseInt(match[1], 10);
            if (orderNum > maxOrderNo) {
              maxOrderNo = orderNum;
            }
          }
        }
      });
      
      let nextOrderNo = `${orderMode}-${currentYear}-${String(maxOrderNo + 1).padStart(2, '0')}`;
      
      // SMC.html 페이지인 경우 (C) 접미사 추가
      if (queryParams.pageType === 'SMC' || queryParams.page === 'SMC') {
        nextOrderNo += '(C)';
      }
      
      return res.json({ 
        success: true, 
        nextOrderNo: nextOrderNo,
        currentMax: maxOrderNo
      });
    }
    
    // 2. 특정 주문 상세 데이터 요청
    if (queryParams.orderId) {
      const specificOrder = orderData.find(order => order.orderId === queryParams.orderId);
      
      if (!specificOrder) {
        return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
      }
      
      return res.json(specificOrder);
    }
    
    // 3. 전체 주문 목록 반환
    res.json(orderData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to process orders request' });
  }
});

// POST /api/saveOrder => order.html 전용 주문 데이터 저장/업데이트
app.post("/api/saveOrder", (req, res) => {
  const data = req.body;
  if (!data) {
    return res.status(400).json({ error: "Invalid body" });
  }

  try {
    // 1. 서버 메모리에서 데이터 읽기 (다른 API와 일관성 유지)
    // 전역 orderStore 사용 (서버 시작 시 이미 로드됨)

    // 아이템 처리 결과 추적
    let updatedItems = 0;
    let createdItems = 0;
    
    // orderId로 기존 주문 찾기
    let existingOrder = null;
    if (data.orderId) {
      existingOrder = orderStore.find(order => order.orderId === data.orderId);
    }
    
    if (existingOrder) {
      // 기존 주문 업데이트 - 지정된 필드만 업데이트하고 나머지는 보존
      
      // 주문 레벨 필드 업데이트 (지정된 필드만)
      if (data.mode !== undefined) existingOrder.mode = data.mode;
      if (data.orderId !== undefined) existingOrder.orderId = data.orderId;
      if (data.orderDate !== undefined) existingOrder.orderDate = data.orderDate;
      if (data.expectedDate !== undefined) existingOrder.expectedDate = data.expectedDate;
      
      // 아이템 레벨 필드 업데이트 (현재 화면 rowNumber 순서대로 처리)
      if (data.items && data.items.length > 0) {
        // 현재 화면의 rowNumber 순서대로 처리
        data.items.forEach((newItem, index) => {
          if (newItem.phd && newItem.width && newItem.length) {
            // phd + width + length 조합으로 기존 아이템 찾기
            const existingItemIndex = existingOrder.items.findIndex(item => 
              item.phd === newItem.phd && item.width === newItem.width && item.length === newItem.length
            );
            
            if (existingItemIndex !== -1) {
              // 기존 아이템 업데이트 - rowNumber, x, kg, quantity, adjustment만 업데이트
              const existingItem = existingOrder.items[existingItemIndex];
              
              // 현재 화면의 rowNumber로 업데이트
              existingItem.rowNumber = newItem.rowNumber;
              // x, kg, quantity, adjustment 업데이트
              if (newItem.x !== undefined) existingItem.x = newItem.x;
              if (newItem.kg !== undefined) existingItem.kg = newItem.kg;
              if (newItem.quantity !== undefined) existingItem.quantity = newItem.quantity;
              if (newItem.adjustment !== undefined) existingItem.adjustment = newItem.adjustment;
              
              updatedItems++;
            } else {
              // 새 아이템 추가 - 현재 화면의 값 그대로 추가
              const newItemToAdd = {
                rowNumber: newItem.rowNumber,  // 현재 화면의 rowNumber
                phd: newItem.phd,
                width: newItem.width,
                length: newItem.length,
                x: newItem.x,
                kg: newItem.kg,
                quantity: newItem.quantity,
                adjustment: newItem.adjustment
              };
              existingOrder.items.push(newItemToAdd);
              
              createdItems++;
            }
          }
        });
      }
    } else {
      // 새 주문 생성
      const newOrder = {
        mode: data.mode || "NT",
        orderId: data.orderId,
        orderDate: data.orderDate,
        expectedDate: data.expectedDate,
        items: data.items || []
      };
      
      // 새 주문의 아이템들 rowNumber 설정 (현재 화면 순서 그대로)
      if (newOrder.items.length > 0) {
        createdItems = newOrder.items.length;
      }
      
      orderStore.push(newOrder);
    }
    
    // 3. 서버 메모리에서 정렬
    orderStore = sortOrderStore(orderStore);
    
    // 4. 하드 디스크에 저장 (orderData.json 확인 후 저장)
    if (!fs.existsSync(ORDER_DATA_FILE)) {
      fs.writeFileSync(ORDER_DATA_FILE, JSON.stringify([], null, 2), "utf8");
    }
    fs.writeFileSync(ORDER_DATA_FILE, JSON.stringify(orderStore, null, 2), "utf8");

    res.json({ 
      message: `Order saved successfully`,
      orderId: data.orderId || 'new',
      updatedItems: updatedItems,
      createdItems: createdItems
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to save order", details: error.message });
  }
});

// DELETE /api/deleteItem - 특정 아이템 삭제
app.delete('/api/deleteItem', (req, res) => {
  try {
    const { orderId, phd, width, length, adjustment } = req.body;
    
    // 1. 서버 메모리에서 데이터 읽기 (다른 API와 일관성 유지)
    // 전역 orderStore 사용 (서버 시작 시 이미 로드됨)
    
    // orderId로 주문 찾기
    const existingOrderIndex = orderStore.findIndex(order => order.orderId === orderId);
    
    if (existingOrderIndex === -1) {
      return res.status(404).json({ success: false, message: '주문을 찾을 수 없습니다.' });
    }
    
    const existingOrder = orderStore[existingOrderIndex];
    
    // 해당 아이템 찾아서 삭제 (phd + width + length + adjustment로 고유 식별)
    const originalLength = existingOrder.items.length;
    
    existingOrder.items = existingOrder.items.filter(item => {
      // 데이터 타입을 고려한 비교 (문자열과 숫자 모두 처리)
      const phdMatch = String(item.phd) === String(phd);
      const widthMatch = String(item.width) === String(width);
      const lengthMatch = String(item.length) === String(length);
      const adjustmentMatch = String(item.adjustment) === String(adjustment);
      const isMatch = phdMatch && widthMatch && lengthMatch && adjustmentMatch;
      
      return !isMatch;
    });
    
    // 아이템이 실제로 삭제되었는지 확인
    const deletedCount = originalLength - existingOrder.items.length;
    if (deletedCount === 0) {
      return res.status(404).json({ success: false, message: '삭제할 아이템을 찾을 수 없습니다.' });
    }
    
    // 3. 서버 메모리에서 정렬
    orderStore = sortOrderStore(orderStore);
    
    // 4. 하드 디스크에 저장
    fs.writeFileSync(ORDER_DATA_FILE, JSON.stringify(orderStore, null, 2), "utf8");
    
    res.json({ success: true, message: '아이템이 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// POST /api/syncRowNumbers - rowNumber 동기화
app.post('/api/syncRowNumbers', (req, res) => {
  try {
    const { orderId, rowData } = req.body;
    
    if (!orderId || !rowData) {
      return res.status(400).json({ 
        success: false, 
        message: '필수 필드가 누락되었습니다.' 
      });
    }
    
    // 주문 찾기
    const existingOrder = orderStore.find(order => order.orderId === orderId);
    
    if (!existingOrder) {
      return res.status(404).json({ 
        success: false, 
        message: '주문을 찾을 수 없습니다.' 
      });
    }
    
    // 화면의 행 데이터를 기반으로 서버의 rowNumber 업데이트
    rowData.forEach(({ phd, width, length, newRowNumber }) => {
      const item = existingOrder.items.find(item => {
        // 데이터 타입을 고려한 비교 (문자열과 숫자 모두 처리)
        const phdMatch = String(item.phd) === String(phd);
        const widthMatch = String(item.width) === String(width);
        const lengthMatch = String(item.length) === String(length);
        return phdMatch && widthMatch && lengthMatch;
      });
      
      if (item) {
        item.rowNumber = newRowNumber;
      }
    });
    
    // orderStore 정렬 후 파일에 저장
    orderStore = sortOrderStore(orderStore);
    fs.writeFileSync(ORDER_DATA_FILE, JSON.stringify(orderStore, null, 2), "utf8");
    
    res.json({ 
      success: true, 
      message: 'rowNumber 동기화가 완료되었습니다.' 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: '서버 오류' 
    });
  }
});

// DELETE /api/orders => 주문 삭제
app.delete("/api/orders", (req, res) => {
  try {
    const { orderNo, orderId } = req.query;
    
    
    if (!orderNo && !orderId) {
      return res.status(400).json({ 
        success: false, 
        message: "orderNo 또는 orderId 파라미터가 필요합니다." 
      });
    }
    
    // 서버 메모리에서 데이터 읽기 (다른 API와 일관성 유지)
    let orderData = orderStore;
    
    // orderData에서 해당 주문 찾기 (orderNo와 orderId 모두 확인)
    const searchValue = orderNo || orderId;
    const orderIndex = orderData.findIndex(o => o.orderNo === searchValue || o.orderId === searchValue);
    
    if (orderIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        message: "주문을 찾을 수 없습니다." 
      });
    }
    
    // 주문 삭제
    const deletedOrder = orderData.splice(orderIndex, 1)[0];
    
    // 서버 메모리 업데이트
    orderStore = orderData;
    
    // orderStore 정렬 후 파일에 저장
    orderStore = sortOrderStore(orderStore);
    fs.writeFileSync(ORDER_DATA_FILE, JSON.stringify(orderStore, null, 2), "utf8");
    
    
    res.json({ 
      success: true, 
      message: `주문 "${searchValue}"이 성공적으로 삭제되었습니다.`,
      deletedOrder: deletedOrder
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: "주문 삭제에 실패했습니다.", 
      details: error.message 
    });
  }
});

// POST /api/updateOrder => 주문 업데이트 (기존 주문/아이템만, 생성 안함)
app.post("/api/updateOrder", (req, res) => {
  const data = req.body;
  if (!data) {
    return res.status(400).json({ error: "Invalid body" });
  }

  try {
    // 서버 메모리에서 데이터 읽기 (다른 API와 일관성 유지)
    // 전역 orderStore 사용 (서버 시작 시 이미 로드됨)

    // orderId 또는 orderNo로 주문 찾기 (페이지에서 설정한 방식)
    let existingOrder = null;
    
    if (data.searchOrderBy === 'orderId' && data.orderId) {
      existingOrder = orderStore.find(order => order.orderId === data.orderId);
    } else if (data.searchOrderBy === 'orderNo' && data.orderNo) {
      existingOrder = orderStore.find(order => order.orderNo === data.orderNo);
    } else if (data.searchOrderBy === 'deliveryNo' && data.deliveryNo) {
      // deliveryNo로 주문 찾기 (아이템 레벨에서 deliveryNo 검색)
      existingOrder = orderStore.find(order => 
        order.items && order.items.some(item => 
          (item.deliveryNo === data.deliveryNo) || (item.deliveryNo === data.deliveryNo)
        )
      );
    }
    
    // 주문을 찾지 못하면 오류
    if (!existingOrder) {
      return res.status(404).json({ 
        error: "주문을 찾을 수 없습니다.", 
        message: `검색 조건: ${data.searchOrderBy}=${data.orderId || data.orderNo || data.deliveryNo}` 
      });
    }

    // 아이템 처리 결과 추적
    let updatedItems = 0;
    let updatedFields = 0;
    
    // 주문 레벨 필드 업데이트 (페이지에서 설정한 항목만)
    if (data.updateFields && data.updateFields.length > 0) {
      data.updateFields.forEach(field => {
        if (data[field] !== undefined) {
          existingOrder[field] = data[field];
          updatedFields++;
        }
      });
    }
    
    // 아이템 레벨 필드 업데이트
    let skippedItems = 0;
    if (data.items && data.items.length > 0) {
      data.items.forEach((newItem) => {
        let existingItemIndex = -1;
        
        // 페이지에서 설정한 검색 방식으로 아이템 찾기
        if (data.searchMethod === 'rowNumber' && newItem.rowNumber) {
          existingItemIndex = existingOrder.items.findIndex(item => item.rowNumber === newItem.rowNumber);
        } else if (data.searchMethod === 'itemNo' && newItem.itemNo) {
          existingItemIndex = existingOrder.items.findIndex(item => item.itemNo === newItem.itemNo);
        } else if (data.searchMethod === 'phdWidthLength' && newItem.phd && newItem.width && newItem.length) {
          existingItemIndex = existingOrder.items.findIndex(item => 
            item.phd === newItem.phd && item.width === newItem.width && item.length === newItem.length
          );
        } else if (data.searchMethod === 'deliveryNo' && newItem.deliveryNo) {
          // deliveryNo로 검색할 때는 모든 매칭되는 아이템을 업데이트
          const matchingItems = existingOrder.items.filter(item => 
            (item.deliveryNo === newItem.deliveryNo) || (item.deliveryNo === newItem.deliveryNo)
          );
          
          if (matchingItems.length > 0) {
            // 모든 매칭되는 아이템 업데이트
            matchingItems.forEach(matchingItem => {
              if (data.itemUpdateFields && data.itemUpdateFields.length > 0) {
                data.itemUpdateFields.forEach(field => {
                  if (newItem[field] !== undefined) {
                    // 빈 문자열이면 필드 삭제, 아니면 값 설정
                    if (newItem[field] === '' || newItem[field] === null) {
                      delete matchingItem[field];
                    } else {
                    matchingItem[field] = newItem[field];
                    }
                  }
                });
              }
            });
            updatedItems += matchingItems.length;
          } else {
            skippedItems++;
          }
          
          // findIndex는 사용하지 않음 (이미 처리했으므로)
          existingItemIndex = -2; // 특별한 값으로 설정하여 아래 로직 건너뛰기
        }
        
        if (existingItemIndex === -2) {
          // deliveryNo 검색의 경우 이미 처리됨, 건너뛰기
        } else if (existingItemIndex !== -1) {
          // 기존 아이템 업데이트
          const existingItem = existingOrder.items[existingItemIndex];
          
          // 페이지에서 설정한 업데이트 항목만 업데이트
          if (data.itemUpdateFields && data.itemUpdateFields.length > 0) {
            data.itemUpdateFields.forEach(field => {
              if (newItem[field] !== undefined) {
                // 빈 문자열이면 필드 삭제, 아니면 값 설정
                if (newItem[field] === '' || newItem[field] === null) {
                  delete existingItem[field];
                } else {
                existingItem[field] = newItem[field];
                }
              }
            });
          }
          
          updatedItems++;
        } else {
          // 아이템을 찾지 못하면 건너뛰기 (오류 대신)
          skippedItems++;
        }
      });
    }
    
    // orderStore 정렬 후 파일에 저장
    orderStore = sortOrderStore(orderStore);
    fs.writeFileSync(ORDER_DATA_FILE, JSON.stringify(orderStore, null, 2), "utf8");

    res.json({ 
      message: `Order updated successfully`,
      orderId: data.orderId || data.orderNo || data.deliveryNo || 'unknown',
      updatedFields: updatedFields,
      updatedItems: updatedItems,
      skippedItems: skippedItems
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update order", details: error.message });
  }
});

// POST /api/split => 새 아이템 생성 (Split 기능)
app.post("/api/split", (req, res) => {
  try {
    const { orderNo, originalItemNo } = req.body;
    
    if (!orderNo || !originalItemNo) {
      return res.status(400).json({ 
        success: false, 
        message: "필수 필드가 누락되었습니다." 
      });
    }
    
    // 1. 서버 메모리에서 데이터 읽기 (다른 API와 일관성 유지)
    // 전역 orderStore 사용 (서버 시작 시 이미 로드됨)
    
    let newItemCreated = false;
    
    // 해당 주문 찾기
    const order = orderStore.find(o => o.orderNo === orderNo);
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: "주문을 찾을 수 없습니다." 
      });
    }
    
    // 원본 아이템 찾기
    const originalItem = order.items.find(item => item.itemNo === originalItemNo);
    if (!originalItem) {
      return res.status(404).json({ 
        success: false, 
        message: "아이템을 찾을 수 없습니다." 
      });
    }
    
    
    // 2. 새로운 아이템 생성 (0001.1)
    const newItemNo = originalItemNo + '.1';
    
    // leftoverR 계산 (adjustment - deliveredR)
    const adjustment = parseFloat(originalItem.adjustment || '0');
    const deliveredR = parseFloat(originalItem.deliveredR || '0');
    const leftoverR = (adjustment - deliveredR).toString();
    
    // tfkg과 producedkg 계산
    const originalTfkg = parseFloat(originalItem.tfkg || '0');
    const originalProducedkg = parseFloat(originalItem.producedkg || '0');
    const originalDeliveredkg = parseFloat(originalItem.deliveredkg || '0');
    
    const newTfkg = (originalTfkg - originalDeliveredkg).toFixed(3);
    const newProducedkg = (originalProducedkg - originalDeliveredkg).toFixed(3);
    
            const newItem = {
              // 기본 아이템 정보 (원본 그대로) - deliveryNo까지의 데이터
              rowNumber: originalItem.rowNumber,
              phd: originalItem.phd,
              width: originalItem.width,
              length: originalItem.length,
              x: originalItem.x,
              kg: originalItem.kg,
              quantity: originalItem.quantity,
              adjustment: leftoverR, // 남은R 값을 adjustment에 설정
              unitPrice: originalItem.unitPrice,
              itemNo: newItemNo,
              w: originalItem.w,
              tfkg: newTfkg, // tfkg = 원본 tfkg - deliveredkg
              producedkg: newProducedkg, // producedkg = 원본 producedkg - deliveredkg
              deliveredkg: '0.0', // deliveredkg을 0.0으로 설정
              isProductionComplete: false
              // issplit 항목 없음 - 새 아이템은 다시 split 가능
            };
    
    // 2. 새 아이템을 원본 아이템 바로 다음에 삽입
    const originalIndex = order.items.findIndex(item => item.itemNo === originalItemNo);
    order.items.splice(originalIndex + 1, 0, newItem);
    newItemCreated = true;
    
    // 3. 서버 메모리에서 정렬
    orderStore = sortOrderStore(orderStore);
    
    // 4. 하드 디스크에 저장
    fs.writeFileSync(ORDER_DATA_FILE, JSON.stringify(orderStore, null, 2));
    
    
    res.json({ 
      success: true, 
      message: "새 아이템이 성공적으로 생성되었습니다.",
      newItemCreated: newItemCreated,
      originalItemNo: originalItemNo,
      newItemNo: newItemNo
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: "아이템 분할 중 오류가 발생했습니다." 
    });
  }
});



// POST /api/deletedeliveryNo => deliveryNo 기반 또는 특정 아이템의 D/N, P/I 정보 삭제
app.post("/api/deletedeliveryNo", (req, res) => {
  try {
    const { deliveryNo, orderNo, itemNo } = req.body;
    
    // deliveryNo가 있으면 우선 처리, 없으면 orderNo + itemNo로 처리
    if (!deliveryNo && (!orderNo || !itemNo)) {
      return res.status(400).json({ 
        success: false, 
        message: "deliveryNo 또는 (orderNo + itemNo)가 필요합니다." 
      });
    }
    
    // 1. 서버 메모리에서 데이터 읽기 (다른 API와 일관성 유지)
    // 전역 orderStore 사용 (서버 시작 시 이미 로드됨)
    
    let updatedCount = 0;
    let processedItems = [];
    
    // 보존할 필드들 (deliveryNo 포함 그 이후 데이터 제거 후 보존할 필드들)
    const preservedFields = [
      'rowNumber', 'phd', 'width', 'length', 'x', 'kg', 'quantity', 
      'adjustment', 'unitPrice', 'itemNo', 'w', 'tfkg', 'producedkg', 
      'deliveredkg', 'isProductionComplete'
    ];
    
    if (deliveryNo) {
      // 1. deliveryNo 기반: 모든 아이템에서 해당 deliveryNo 찾아서 삭제
      orderStore.forEach(order => {
        if (order.items && order.items.length > 0) {
          order.items.forEach(item => {
            const itemDeliveryNo = item.deliveryNo || item.deliveryNo;
            if (itemDeliveryNo === deliveryNo) {
              // deliveryNo 포함 그 이후 데이터 제거
              const cleanedItem = {};
              preservedFields.forEach(field => {
                if (item[field] !== undefined) {
                  cleanedItem[field] = item[field];
                }
              });
              
              // 기존 아이템을 정리된 아이템으로 교체
              Object.keys(item).forEach(key => delete item[key]);
              Object.assign(item, cleanedItem);
              
              updatedCount++;
              processedItems.push({
                orderNo: order.orderNo,
                itemNo: item.itemNo
              });
            }
          });
        }
      });
      
      if (updatedCount === 0) {
        return res.status(404).json({ 
          success: false, 
          message: `deliveryNo '${deliveryNo}'를 찾을 수 없습니다.` 
        });
      }
      
    } else {
      // 2. 특정 아이템: orderNo + itemNo로 특정 아이템만 처리
      const order = orderStore.find(o => o.orderNo === orderNo);
      if (!order) {
        return res.status(404).json({ 
          success: false, 
          message: `주문번호 '${orderNo}'을 찾을 수 없습니다.` 
        });
      }
      
      const item = order.items.find(item => item.itemNo === itemNo);
      if (!item) {
        return res.status(404).json({ 
          success: false, 
          message: `아이템 '${itemNo}'을 찾을 수 없습니다.` 
        });
      }
      
      // deliveryNo 포함 그 이후 데이터 제거
      const cleanedItem = {};
      preservedFields.forEach(field => {
        if (item[field] !== undefined) {
          cleanedItem[field] = item[field];
        }
      });
      
      // 기존 아이템을 정리된 아이템으로 교체
      Object.keys(item).forEach(key => delete item[key]);
      Object.assign(item, cleanedItem);
      
      updatedCount = 1;
      processedItems.push({
        orderNo: orderNo,
        itemNo: itemNo
      });
    }
    
    // 3. 서버 메모리에서 정렬
    orderStore = sortOrderStore(orderStore);
    
    // 4. 하드 디스크에 저장
    fs.writeFileSync(ORDER_DATA_FILE, JSON.stringify(orderStore, null, 2), "utf8");
    
    res.json({ 
      success: true, 
      message: `${deliveryNo ? `deliveryNo '${deliveryNo}'` : `아이템 ${orderNo}-${itemNo}`}의 정보가 성공적으로 삭제되었습니다.`,
      updatedCount: updatedCount,
      processedItems: processedItems,
      deliveryNo: deliveryNo || null,
      orderNo: orderNo || null,
      itemNo: itemNo || null
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: "정보 삭제 중 오류가 발생했습니다." 
    });
  }
});

//===================================================
// uploads 관련 API 모음
//===================================================

// 파일 업로드: POST /api/uploadFile
app.post('/api/uploadFile', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 선택되지 않았습니다.' });
    }

    const { mode, orderNo, orderId, fileType, itemNo, originalFileName, deliveryNo, year, headerName, rowName } = req.body;
    
    // 경로 구조 결정
    let finalPath, fileInfo;
    
    if (mode === 'admin') {
      // admin.html용 (uploads/엘트로코리아 경로 구조)
      finalPath = path.join(UPLOAD_DIR, '엘트로코리아');
      fileInfo = {
        originalName: req.file.originalname,
        filename: originalFileName || req.file.originalname,
        path: '',
        size: req.file.size,
        mode: 'admin',
        uploadDate: new Date().toISOString()
      };
    } else if (mode === '세무자료' && year && headerName && rowName) {
      // taxreport.html용 (세무자료 경로 구조)
      // uploads/세무자료/{year}/{headerName}/{rowName}/
      finalPath = path.join(UPLOAD_DIR, '세무자료', year, headerName, rowName);
      fileInfo = {
        originalName: req.file.originalname,
        filename: originalFileName || req.file.originalname,
        path: '',
        size: req.file.size,
        mode: '세무자료',
        year: year,
        headerName: headerName,
        rowName: rowName,
        uploadDate: new Date().toISOString()
      };
    } else if (deliveryNo && fileType) {
      // shipmentarchive.html용 (DeliveryNo 경로 구조) - 모드별 분리
      // req.body에서 전달받은 mode 사용 (클라이언트에서 설정한 모드 사용)
      const uploadMode = mode || 'NT'; // req.body의 mode 사용, 없으면 기본값 NT
      
      finalPath = path.join(UPLOAD_DIR, uploadMode, 'DeliveryNO', deliveryNo, fileType);
      fileInfo = {
        originalName: req.file.originalname,
        filename: originalFileName || req.file.originalname,
        path: '',
        size: req.file.size,
        deliveryNo: deliveryNo,
        fileType: fileType,
        mode: uploadMode,
        uploadDate: new Date().toISOString()
      };
    } else if (mode && orderId && fileType) {
      // orderarchive.html용 (OrderID 경로 구조)
      finalPath = path.join(UPLOAD_DIR, mode, 'OrderID', orderId, fileType);
      fileInfo = {
        originalName: req.file.originalname,
        filename: originalFileName || req.file.originalname,
        path: '',
        size: req.file.size,
        mode: mode,
        orderId: orderId,
        fileType: fileType,
        uploadDate: new Date().toISOString()
      };
    } else if (mode && orderNo && itemNo) {
      // production.html용 (OrderNO 경로 구조)
      finalPath = path.join(UPLOAD_DIR, mode, 'OrderNO', orderNo, itemNo);
      fileInfo = {
        originalName: req.file.originalname,
        filename: originalFileName || req.file.originalname,
        path: '',
        size: req.file.size,
        mode: mode,
        orderNo: orderNo,
        itemNo: itemNo,
        uploadDate: new Date().toISOString()
      };
    } else {
      return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }
    
    // 폴더가 없으면 생성
    if (!fs.existsSync(finalPath)) {
      fs.mkdirSync(finalPath, { recursive: true });
    }
    
    // 최종 파일 경로
    const filePath = path.join(finalPath, fileInfo.filename);
    fileInfo.path = filePath;
    
    // 파일 저장
    fs.writeFileSync(filePath, req.file.buffer);
    
    res.json({ 
      success: true, 
      message: '파일이 성공적으로 업로드되었습니다.',
      fileInfo: fileInfo
    });

  } catch (error) {
    res.status(500).json({ error: '파일 업로드 중 오류가 발생했습니다.' });
  }
});

//===================================================
// OrderID (orderarchive.html)
//===================================================
//파일 확인: GET /api/listFiles/{mode}/{orderId}/{fileType}
app.get('/api/listFiles/:mode/:orderId/:fileType', (req, res) => {
  try {
    const { mode, orderId, fileType } = req.params;
    const dirPath = path.join(UPLOAD_DIR, mode, 'OrderID', orderId, fileType);
    
    if (!fs.existsSync(dirPath)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(dirPath).map(filename => {
      const stats = fs.statSync(path.join(dirPath, filename));
      return {
        filename,
        size: stats.size,
        uploadDate: stats.mtime.toISOString()
      };
    });
    
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: '파일 목록 조회 중 오류가 발생했습니다.' });
  }
});

//파일 미리보기: GET /api/previewFile/{mode}/{orderId}/{fileType}/{filename}
app.get('/api/previewFile/:mode/:orderId/:fileType/:filename', (req, res) => {
  try {
    const { mode, orderId, fileType, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, mode, 'OrderID', orderId, fileType, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    // 파일 확장자 확인
    const ext = path.extname(decodedFilename).toLowerCase();
    
    if (['.pdf', '.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
      // Content-Type 매핑 (전역 상수로 최적화 가능)
      const contentType = ext === '.pdf' ? 'application/pdf' :
                        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                        ext === '.png' ? 'image/png' : 'image/gif';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(decodedFilename)}`);
      res.sendFile(filePath);
    } else {
      res.status(400).json({ error: '미리보기 불가능한 파일 형식입니다.' });
    }
  } catch (error) {
    res.status(500).json({ error: '파일 미리보기 중 오류가 발생했습니다.' });
  }
});



//파일 다운로드: GET /api/downloadFile/{mode}/{orderId}/{fileType}/{filename}
app.get('/api/downloadFile/:mode/:orderId/:fileType/:filename', (req, res) => {
  try {
    const { mode, orderId, fileType, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, mode, 'OrderID', orderId, fileType, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    res.download(filePath, decodedFilename);
  } catch (error) {
    res.status(500).json({ error: '파일 다운로드 중 오류가 발생했습니다.' });
  }
});

//파일 삭제: DELETE /api/deleteFile/{mode}/{orderId}/{fileType}/{filename}
app.delete('/api/deleteFile/:mode/:orderId/:fileType/:filename', (req, res) => {
  try {
    const { mode, orderId, fileType, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    
    // OrderID 경로에서 파일 찾기 (주로 사용되는 경로)
    const filePath = path.join(UPLOAD_DIR, mode, 'OrderID', orderId, fileType, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    fs.unlinkSync(filePath);
    res.json({ success: true, message: '파일이 성공적으로 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '파일 삭제 중 오류가 발생했습니다.' });
  }
});

//===================================================
// OrderNO (Production.html)
//===================================================

// 파일 목록 조회 API (OrderNO 경로 구조 - itemNo 폴더만 확인)
app.get('/api/listFiles/:mode/OrderNO/:orderNo/:itemNo', (req, res) => {
  try {
    const { mode, orderNo, itemNo } = req.params;
    const dirPath = path.join(UPLOAD_DIR, mode, 'OrderNO', orderNo, itemNo);
    
    if (!fs.existsSync(dirPath)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(dirPath).map(filename => {
      const stats = fs.statSync(path.join(dirPath, filename));
      return {
        filename,
        size: stats.size,
        uploadDate: stats.mtime.toISOString()
      };
    });
    
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: '파일 목록 조회 중 오류가 발생했습니다.' });
  }
});
// 파일 미리보기 API (OrderNO 경로 구조 - itemNo 폴더에서 직접 미리보기)
app.get('/api/previewFile/:mode/OrderNO/:orderNo/:itemNo/:filename', (req, res) => {
  try {
    const { mode, orderNo, itemNo, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, mode, 'OrderNO', orderNo, itemNo, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    // 파일 확장자 확인
    const ext = path.extname(decodedFilename).toLowerCase();
    
    if (['.pdf', '.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
      // Content-Type 매핑
      const contentType = ext === '.pdf' ? 'application/pdf' :
                        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                        ext === '.png' ? 'image/png' : 'image/gif';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(decodedFilename)}`);
      res.sendFile(filePath);
    } else {
      res.status(400).json({ error: '미리보기 불가능한 파일 형식입니다.' });
    }
  } catch (error) {
    res.status(500).json({ error: '파일 미리보기 중 오류가 발생했습니다.' });
  }
});

//파일 다운로드 API (OrderNO 경로 구조 - itemNo 폴더에서 직접 다운로드)
app.get('/api/downloadFile/:mode/OrderNO/:orderNo/:itemNo/:filename', (req, res) => {
  try {
    const { mode, orderNo, itemNo, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, mode, 'OrderNO', orderNo, itemNo, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    res.download(filePath, decodedFilename);
  } catch (error) {
    res.status(500).json({ error: '파일 다운로드 중 오류가 발생했습니다.' });
  }
});


// 파일 삭제 API (OrderNO 경로 구조 - production.html용)
app.delete('/api/deleteFile/:mode/OrderNO/:orderNo/:itemNo/:filename', (req, res) => {
  try {
    const { mode, orderNo, itemNo, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, mode, 'OrderNO', orderNo, itemNo, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    fs.unlinkSync(filePath);
    res.json({ success: true, message: '파일이 성공적으로 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '파일 삭제 중 오류가 발생했습니다.' });
  }
});

//===================================================
// DeliveryNO (ShipmentArchive.html)
//===================================================

// 파일 목록 조회: GET /api/listFiles/{mode}/DeliveryNO/{deliveryNo}/{fileType} (OrderID/OrderNO와 동일한 구조)
app.get('/api/listFiles/:mode/DeliveryNO/:deliveryNo/:fileType', (req, res) => {
  try {
    const { mode, deliveryNo, fileType } = req.params;
    const dirPath = path.join(UPLOAD_DIR, mode, 'DeliveryNO', deliveryNo, fileType);
    
    if (!fs.existsSync(dirPath)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(dirPath).map(filename => {
      const stats = fs.statSync(path.join(dirPath, filename));
      return {
        filename: filename,
        size: stats.size,
        path: path.join(dirPath, filename)
      };
    });
    
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: '파일 목록 조회에 실패했습니다.' });
  }
});

// 파일 미리보기: GET /api/previewFile/{mode}/DeliveryNO/{deliveryNo}/{fileType}/{filename} (OrderID/OrderNO와 동일한 구조)
app.get('/api/previewFile/:mode/DeliveryNO/:deliveryNo/:fileType/:filename', (req, res) => {
  try {
    const { mode, deliveryNo, fileType, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    
    const filePath = path.join(UPLOAD_DIR, mode, 'DeliveryNO', deliveryNo, fileType, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: '파일 미리보기에 실패했습니다.' });
  }
});

// 파일 다운로드: GET /api/downloadFile/{mode}/DeliveryNO/{deliveryNo}/{fileType}/{filename} (OrderID/OrderNO와 동일한 구조)
app.get('/api/downloadFile/:mode/DeliveryNO/:deliveryNo/:fileType/:filename', (req, res) => {
  try {
    const { mode, deliveryNo, fileType, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    
    const filePath = path.join(UPLOAD_DIR, mode, 'DeliveryNO', deliveryNo, fileType, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    res.download(filePath, decodedFilename);
  } catch (error) {
    res.status(500).json({ error: '파일 다운로드에 실패했습니다.' });
  }
});

// 파일 삭제: DELETE /api/deleteFile/{mode}/DeliveryNO/{deliveryNo}/{fileType}/{filename} (OrderID/OrderNO와 동일한 구조)
app.delete('/api/deleteFile/:mode/DeliveryNO/:deliveryNo/:fileType/:filename', (req, res) => {
  try {
    const { mode, deliveryNo, fileType, filename } = req.params;
    const decodedFilename = decodeURIComponent(filename);
    
    const filePath = path.join(UPLOAD_DIR, mode, 'DeliveryNO', deliveryNo, fileType, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    fs.unlinkSync(filePath);
    res.json({ message: '파일이 성공적으로 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '파일 삭제에 실패했습니다.' });
  }
});

// 분석표 복사 API (deliveryNo의 모든 아이템 분석표를 복사)
app.post('/api/copyAnalysisFiles', async (req, res) => {
  try {
    const { mode, deliveryNo } = req.body;
    
    if (!mode || !deliveryNo) {
      return res.status(400).json({ error: 'mode와 deliveryNo가 필요합니다.' });
    }
    
    // 해당 deliveryNo에 속한 모든 주문과 아이템 찾기
    const matchingOrders = [];
    
    for (const order of orderStore) {
      if (order.items) {
        for (const item of order.items) {
          if (item.deliveryNo === deliveryNo) {
            matchingOrders.push({
              orderNo: order.orderNo,
              itemNo: item.itemNo
            });
          }
        }
      }
    }
    
    if (matchingOrders.length === 0) {
      return res.status(404).json({ error: '해당 deliveryNo에 매칭되는 아이템이 없습니다.' });
    }
    
    // 분석표 복사 작업
    const copyResults = [];
    const targetDir = path.join(UPLOAD_DIR, mode, 'DeliveryNO', deliveryNo, '분석표');
    
    // 대상 디렉토리 생성
    fs.mkdirSync(targetDir, { recursive: true });
    
    for (const { orderNo, itemNo } of matchingOrders) {
      const sourceDir = path.join(UPLOAD_DIR, mode, 'OrderNO', orderNo, itemNo);
      
      if (fs.existsSync(sourceDir)) {
        const files = fs.readdirSync(sourceDir);
        
        for (const file of files) {
          const sourcePath = path.join(sourceDir, file);
          const targetPath = path.join(targetDir, `${orderNo}_${itemNo}_${file}`);
          
          try {
            fs.copyFileSync(sourcePath, targetPath);
            copyResults.push({
              orderNo,
              itemNo,
              fileName: file,
              copied: true
            });
          } catch (error) {
            copyResults.push({
              orderNo,
              itemNo,
              fileName: file,
              copied: false,
              error: error.message
            });
          }
        }
      }
    }
    
    res.json({
      success: true,
      deliveryNo,
      copiedFiles: copyResults,
      totalCopied: copyResults.filter(r => r.copied).length
    });
    
  } catch (error) {
    res.status(500).json({ error: '분석표 복사 중 오류가 발생했습니다.' });
  }
});

// 분석표 폴더 ZIP 다운로드 API
app.get('/api/downloadAnalysisFolder/:mode/:deliveryNo', (req, res) => {
  const { mode, deliveryNo } = req.params;
  const analysisDir = path.join(UPLOAD_DIR, mode, 'DeliveryNO', deliveryNo, '분석표');
  
  // 분석표 폴더가 존재하는지 확인
  if (!fs.existsSync(analysisDir)) {
    return res.status(404).json({ error: '분석표 폴더가 존재하지 않습니다.' });
  }
  
  // 분석표 폴더의 파일 목록 조회
  const files = fs.readdirSync(analysisDir);
  
  if (files.length === 0) {
    return res.status(404).json({ error: '분석표 파일이 없습니다.' });
  }
  
  // ZIP 파일명 설정
  const zipFileName = `${deliveryNo}분석표.zip`;
  
  // Content-Type과 파일명 설정
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(zipFileName)}`);
  
  // ZIP 아카이브 생성
  const archive = archiver('zip', {
    zlib: { level: 9 } // 최대 압축
  });
  
  // 에러 처리
  archive.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'ZIP 파일 생성 중 오류가 발생했습니다.' });
    }
  });
  
  // 아카이브를 응답에 파이프
  archive.pipe(res);
  
  // 분석표 폴더의 모든 파일을 ZIP에 추가
  files.forEach(file => {
    const filePath = path.join(analysisDir, file);
    if (fs.statSync(filePath).isFile()) {
      archive.file(filePath, { name: file });
    }
  });
  
  // ZIP 아카이브 완료
  archive.finalize();
});

//===================================================
// Credit Note 관련 API 모음
//===================================================

// Credit Note 데이터 조회 엔드포인트
app.get('/api/creditnote', (req, res) => {
  res.json(creditNoteStore);
});

// Credit Note 통합 저장/업데이트 엔드포인트
app.post('/api/creditnote', (req, res) => {
  try {
    const requestData = req.body;
    const { identifier, field, value, action } = requestData;
    
    // 특정 필드만 업데이트하는 경우
    if (action === 'updateField' && identifier && field && value !== undefined) {
      return updateCreditNoteField(identifier, field, value, res);
    }
    
    // 삭제 요청 처리
    if (action === 'delete' && identifier && requestData.type) {
      return deleteCreditNoteItem(requestData.type, identifier, res);
    }
    
    // 배열 데이터 처리 (creditnote.html Add 버튼용)
    if (Array.isArray(requestData)) {
      return handleArrayCreditNoteData(requestData, res);
    }
    
    // 개별 데이터 처리 (creditnoteupdate.html용)
    if (requestData && (requestData["c/nno"] || requestData["o/pno"] || requestData["l/pno"])) {
      return saveOrUpdateCreditNote(requestData, res);
    }
    
    return res.status(400).json({ 
      success: false, 
      message: "유효하지 않은 데이터 형식입니다." 
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: "Credit Note 처리 중 오류가 발생했습니다." 
    });
  }
});

// Credit Note 공통 함수들
function readCreditNoteData() {
  return creditNoteStore;
}

function writeCreditNoteData(creditNoteData) {
  creditNoteStore = creditNoteData;
  fs.writeFileSync(CREDIT_NOTE_FILE, JSON.stringify(creditNoteStore, null, 2), 'utf8');
}

function transformCreditNoteData(data) {
  const transformedData = { ...data };
  if (transformedData.lesspayment !== undefined) {
    transformedData['l/pdollar'] = transformedData.lesspayment;
    delete transformedData.lesspayment;
  }
  if (transformedData['c/nno'] && !transformedData['c/ndollar']) {
    transformedData['c/ndollar'] = '';
  }
  if (transformedData['c/nno'] && !transformedData['c/neuro']) {
    transformedData['c/neuro'] = '';
  }
  return transformedData;
}

function sortCreditNoteData(creditNoteData) {
  return creditNoteData.sort((a, b) => {
    const aHasLP = a["l/pno"] && a["l/pdate"];
    const bHasLP = b["l/pno"] && b["l/pdate"];
    const aHasOP = a["o/pno"] && a["o/pdate"];
    const bHasOP = b["o/pno"] && b["o/pdate"];
    const aHasCN = a["c/nno"] && a["c/ndate"];
    const bHasCN = b["c/nno"] && b["c/ndate"];
    
    const parseDate = (dateStr, isLP = false) => {
      if (!dateStr) return new Date(0);
      const parts = dateStr.split('.');
      if (parts.length >= 3) {
        if (isLP) {
          const year = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1;
          const day = parseInt(parts[2]);
          return new Date(year, month, day);
        } else {
          if (parts[0].length === 4) {
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            const day = parseInt(parts[2]);
            return new Date(year, month, day);
          } else {
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]) - 1;
            const year = parseInt(parts[2]);
            return new Date(year, month, day);
          }
        }
      }
      return new Date(0);
    };
    
    if (aHasLP && !bHasLP) return -1;
    if (!aHasLP && bHasLP) return 1;
    if (aHasLP && bHasLP) {
      const dateA = parseDate(a["l/pdate"], true);
      const dateB = parseDate(b["l/pdate"], true);
      return dateA.getTime() - dateB.getTime();
    }
    
    if (aHasOP && !bHasOP) return -1;
    if (!aHasOP && bHasOP) return 1;
    if (aHasOP && bHasOP) {
      const dateA = parseDate(a["o/pdate"]);
      const dateB = parseDate(b["o/pdate"]);
      return dateA.getTime() - dateB.getTime();
    }
    
    if (aHasCN && bHasCN) {
      const dateA = parseDate(a["c/ndate"]);
      const dateB = parseDate(b["c/ndate"]);
      return dateA.getTime() - dateB.getTime();
    }
    
    return 0;
  });
}

function updateCreditNoteField(identifier, field, value, res) {
  const creditNoteData = readCreditNoteData();
  
  let targetItem = null;
  let targetIndex = -1;
  
  for (let i = 0; i < creditNoteData.length; i++) {
    const item = creditNoteData[i];
    if (item['c/nno'] === identifier || item['o/pno'] === identifier || item['l/pno'] === identifier) {
      targetItem = item;
      targetIndex = i;
      break;
    }
  }
  
  if (!targetItem) {
    return res.status(404).json({ 
      success: false, 
      message: "해당 identifier를 가진 항목을 찾을 수 없습니다." 
    });
  }
  
  targetItem[field] = value;
  writeCreditNoteData(creditNoteData);
  
  res.json({ 
    success: true, 
    message: `${field} 필드가 성공적으로 업데이트되었습니다.`,
    updatedField: field,
    newValue: value
  });
}

function saveOrUpdateCreditNote(data, res) {
  const creditNoteData = readCreditNoteData();
  
  const transformedData = transformCreditNoteData(data);
  
  // 기존 항목 찾아서 업데이트 또는 새로 추가
  let updated = false;
  const newData = creditNoteData.map(item => {
    const cNnoMatch = transformedData['c/nno'] && item['c/nno'] === transformedData['c/nno'];
    const oPnoMatch = transformedData['o/pno'] && item['o/pno'] === transformedData['o/pno'];
    const lPnoMatch = transformedData['l/pno'] && item['l/pno'] === transformedData['l/pno'];
    
    if (cNnoMatch || oPnoMatch || lPnoMatch) {
      updated = true;
      return transformedData;
    }
    return item;
  });
  
  if (!updated) {
    newData.push(transformedData);
  }
  
  const sortedData = sortCreditNoteData(newData);
  writeCreditNoteData(sortedData);
  
  res.json({ 
    success: true, 
    message: updated ? "Credit Note가 성공적으로 업데이트되었습니다." : "Credit Note가 성공적으로 저장되었습니다.",
    totalItems: sortedData.length
  });
}

function handleArrayCreditNoteData(newData, res) {
  const existingData = readCreditNoteData();
  const originalCount = existingData.length;
  const newCount = newData.length;
  
  if (newCount < originalCount) {
    // 삭제된 데이터로 완전히 교체
    const transformedData = newData.map(item => transformCreditNoteData(item));
    const sortedData = sortCreditNoteData(transformedData);
    writeCreditNoteData(sortedData);
    
    return res.json({ 
      success: true, 
      message: "데이터가 삭제되었습니다.",
      count: sortedData.length
    });
  } else {
    // 추가/업데이트인 경우
    let updatedData = [...existingData];
    
    newData.forEach(newItem => {
      const transformedItem = transformCreditNoteData(newItem);
      let found = false;
      
      // 기존 항목 찾아서 업데이트
      updatedData = updatedData.map(item => {
        if ((transformedItem['c/nno'] && item['c/nno'] === transformedItem['c/nno']) ||
            (transformedItem['o/pno'] && item['o/pno'] === transformedItem['o/pno']) ||
            (transformedItem['l/pno'] && item['l/pno'] === transformedItem['l/pno'])) {
          found = true;
          return transformedItem;
        }
        return item;
      });
      
      // 기존 항목이 없으면 새로 추가
      if (!found) {
        updatedData.push(transformedItem);
      }
    });
    
    const sortedData = sortCreditNoteData(updatedData);
    writeCreditNoteData(sortedData);
    
    return res.json({ 
      success: true, 
      message: "데이터가 저장되었습니다.",
      count: sortedData.length
    });
  }
}

// Credit Note 항목 삭제 함수
function deleteCreditNoteItem(type, identifier, res) {
  try {
    const existingData = readCreditNoteData();
    const originalCount = existingData.length;
    
    // 삭제할 항목 찾기
    const filteredData = existingData.filter(item => {
      let shouldKeep = true;
      switch (type) {
        case 'c/nno':
          shouldKeep = item['c/nno'] !== identifier;
          break;
        case 'o/pno':
          shouldKeep = item['o/pno'] !== identifier;
          break;
        case 'l/pno':
          shouldKeep = item['l/pno'] !== identifier;
          break;
        default:
          shouldKeep = true;
      }
      return shouldKeep;
    });
    
    if (filteredData.length === originalCount) {
      return res.status(404).json({
        success: false,
        message: "삭제할 항목을 찾을 수 없습니다."
      });
    }
    
    // 데이터 저장
    const sortedData = sortCreditNoteData(filteredData);
    writeCreditNoteData(sortedData);
    
    res.json({
      success: true,
      message: "항목이 성공적으로 삭제되었습니다.",
      totalItems: sortedData.length
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "삭제 중 오류가 발생했습니다."
    });
  }
}

//===================================================
// calendar 관련 API 모음
//===================================================

// 캘린더 데이터 로드 API
app.get('/api/loadCalendar', (req, res) => {
  try {
    res.json(calendarStore);
  } catch (error) {
    res.status(500).json({ error: '캘린더 데이터 로드 실패' });
  }
});

// 캘린더 데이터 저장 API
app.post('/api/saveCalendar', (req, res) => {
  try {
    calendarStore = req.body;
    // 정렬 후 저장
    calendarStore = sortCalendarData(calendarStore);
    fs.writeFileSync(CALENDAR_DATA_FILE, JSON.stringify(calendarStore, null, 2), 'utf8');
    res.json({ success: true, message: '캘린더 데이터가 저장되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '캘린더 데이터 저장 실패' });
  }
});

// 캘린더 일정 삭제 API
app.delete('/api/deleteCalendarEvent', (req, res) => {
  try {
    const { year, month, day, index } = req.body;
    
    if (!calendarStore.events || !calendarStore.events[year] || !calendarStore.events[year][month] || !calendarStore.events[year][month][day]) {
      return res.status(404).json({ error: '해당 날짜의 일정을 찾을 수 없습니다.' });
    }
    
    if (index < 0 || index >= calendarStore.events[year][month][day].length) {
      return res.status(404).json({ error: '해당 일정을 찾을 수 없습니다.' });
    }
    
    // 일정 삭제
    calendarStore.events[year][month][day].splice(index, 1);
    
    // 빈 배열이면 해당 날짜 객체도 삭제
    if (calendarStore.events[year][month][day].length === 0) {
      delete calendarStore.events[year][month][day];
      
      // 빈 월 객체도 삭제
      if (Object.keys(calendarStore.events[year][month]).length === 0) {
        delete calendarStore.events[year][month];
        
        // 빈 년도 객체도 삭제
        if (Object.keys(calendarStore.events[year]).length === 0) {
          delete calendarStore.events[year];
        }
      }
    }
    
    // 정렬 후 하드에 저장
    calendarStore = sortCalendarData(calendarStore);
    fs.writeFileSync(CALENDAR_DATA_FILE, JSON.stringify(calendarStore, null, 2), 'utf8');
    res.json({ success: true, message: '일정이 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '일정 삭제 실패' });
  }
});

//===================================================
// Transfer 관련 API 모음
//===================================================
// Transfer 데이터 불러오기 (서버 메모리에서)
app.get('/api/transfers', (req, res) => {
  try {
    const { section } = req.query;
    
    if (section === 'transfers') {
      res.json(transferStore.transfers || []);
    } else if (section === 'payrolls') {
      res.json(transferStore.payrolls || []);
    } else if (section === 'deposits') {
      res.json(transferStore.deposits || []);
    } else {
      // section이 없으면 전체 데이터 반환
      res.json(transferStore);
    }
  } catch (error) {
    res.status(500).json({ error: 'Transfer 데이터를 읽을 수 없습니다.' });
  }
});


// Transfer 데이터 저장/업데이트/순서변경 (통합 API)
app.post('/api/transfers', (req, res) => {
  try {
    const newData = req.body;
    const { section, action } = newData;
    
    // 순서 변경 처리
    if (action === 'reorder') {
      const { transfers, payrolls, deposits } = newData;
      
      if (transfers && Array.isArray(transfers)) {
        transferStore.transfers = transfers;
      }
      if (payrolls && Array.isArray(payrolls)) {
        transferStore.payrolls = payrolls;
      }
      if (deposits && Array.isArray(deposits)) {
        transferStore.deposits = deposits;
      }
      
      // 파일에 저장
      fs.writeFileSync(TRANSFER_DATA_FILE, JSON.stringify(transferStore, null, 2));
      res.json({ success: true, action: 'reordered' });
      return;
    }
    
    // 일반 저장/업데이트 처리
    // section이 없으면 자동 판단
    let targetSection = section;
    if (!targetSection) {
      if (newData.hasOwnProperty('name') && newData.hasOwnProperty('position')) {
        targetSection = 'payrolls';
      } else if (newData.hasOwnProperty('sender') && newData.hasOwnProperty('date')) {
        targetSection = 'deposits';
      } else {
        targetSection = 'transfers';
      }
    }
    
    // 해당 섹션이 없으면 생성
    if (!transferStore[targetSection]) {
      transferStore[targetSection] = [];
    }
    
    // 기존 항목 찾기 (description 또는 name으로 매칭)
    const searchKey = targetSection === 'payrolls' ? 'name' : 'description';
    const existingIndex = transferStore[targetSection].findIndex(item => 
      item[searchKey] === newData[searchKey]
    );
    
    if (existingIndex !== -1) {
      // 기존 데이터 업데이트
      const existingId = transferStore[targetSection][existingIndex].id;
      const updatedItem = { id: existingId, ...newData };
      transferStore[targetSection][existingIndex] = updatedItem;
      
      // 파일에 저장
      fs.writeFileSync(TRANSFER_DATA_FILE, JSON.stringify(transferStore, null, 2));
      res.json({ 
        success: true, 
        [targetSection.slice(0, -1)]: updatedItem,
        action: 'updated'
      });
    } else {
      // 빈 데이터 체크
      const isEmpty = Object.values(newData).every(value => 
        value === '' || value === 0 || value === null || value === undefined
      );
      
      if (isEmpty) {
        return res.json({ 
          success: false, 
          message: '빈 데이터는 저장하지 않습니다.'
        });
      }
      
      // 새 데이터 추가
      const newId = transferStore[targetSection].length + 1;
      const newItem = { id: newId, ...newData };
      transferStore[targetSection].push(newItem);
      
      // 파일에 저장
      fs.writeFileSync(TRANSFER_DATA_FILE, JSON.stringify(transferStore, null, 2));
      res.json({ 
        success: true, 
        [targetSection.slice(0, -1)]: newItem,
        action: 'created'
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Transfer 데이터를 저장할 수 없습니다.' });
  }
});

// Transfer 데이터 삭제 API (통합)
app.delete('/api/transfers', (req, res) => {
  try {
    const { description, name, position, section } = req.body;
    
    // section이 없으면 자동 판단
    let targetSection = section;
    if (!targetSection) {
      if (name && position) {
        targetSection = 'payrolls';
      } else if (name) {
        targetSection = 'payrolls';
      } else if (description) {
        // description으로 어떤 섹션인지 찾기
        const transferIndex = transferStore.transfers?.findIndex(item => item.description === description);
        const depositIndex = transferStore.deposits?.findIndex(item => item.description === description);
        
        if (transferIndex !== -1) {
          targetSection = 'transfers';
        } else if (depositIndex !== -1) {
          targetSection = 'deposits';
        } else {
          return res.status(404).json({ error: '해당 데이터를 찾을 수 없습니다.' });
        }
      } else {
        return res.status(400).json({ error: 'description 또는 (name, position)이 필요합니다.' });
      }
    }
    
    // 해당 섹션이 없으면 에러
    if (!transferStore[targetSection]) {
      return res.status(404).json({ error: `${targetSection} 데이터를 찾을 수 없습니다.` });
    }
    
    // 항목 찾기
    let index = -1;
    if (targetSection === 'payrolls') {
      // payrolls는 position과 name을 모두 사용하여 찾기
      if (position && name) {
        index = transferStore[targetSection].findIndex(item => 
          item.position === position && item.name === name
        );
      } else if (name) {
        // name만 있는 경우 (하위 호환성)
        index = transferStore[targetSection].findIndex(item => 
          item.name === name
        );
      }
    } else {
      // transfers, deposits는 description으로 찾기
      if (!description) {
        return res.status(400).json({ error: 'description이 필요합니다.' });
      }
      index = transferStore[targetSection].findIndex(item => 
        item.description === description
      );
    }
    
    if (index === -1) {
      return res.status(404).json({ error: '해당 데이터를 찾을 수 없습니다.' });
    }
    
    // 항목 삭제
    transferStore[targetSection].splice(index, 1);
    
    // ID를 행 번호로 재정렬 (1부터 시작)
    transferStore[targetSection].forEach((item, index) => {
      item.id = index + 1;
    });
    
    fs.writeFileSync(TRANSFER_DATA_FILE, JSON.stringify(transferStore, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '데이터 삭제 중 오류가 발생했습니다.' });
  }
});

//===================================================
// Accounting 관련 API 모음
//===================================================
// Accounting 데이터 정렬 함수
function sortAccountingData(accountingData) {
  // Balance 정렬: 각 계좌별로 날짜가 예전꺼가 위로, 나중꺼가 아래로
  if (accountingData.balance && Array.isArray(accountingData.balance)) {
    accountingData.balance.forEach(item => {
      if (item.balances) {
        // 날짜별로 정렬 (오래된 것부터)
        const sortedBalances = {};
        const sortedDates = Object.keys(item.balances).sort((a, b) => new Date(a) - new Date(b));
        sortedDates.forEach(date => {
          sortedBalances[date] = item.balances[date];
        });
        item.balances = sortedBalances;
      }
    });
  }
  
  // Transaction 정렬: withdrawal과 deposit에서 날짜가 예전꺼가 위로, 나중꺼가 아래로
  if (accountingData.transaction) {
    // withdrawal 정렬
    if (accountingData.transaction.withdrawal) {
      const sortedWithdrawal = {};
      const withdrawalDates = Object.keys(accountingData.transaction.withdrawal).sort((a, b) => new Date(a) - new Date(b));
      withdrawalDates.forEach(date => {
        sortedWithdrawal[date] = accountingData.transaction.withdrawal[date];
      });
      accountingData.transaction.withdrawal = sortedWithdrawal;
    }
    
    // deposit 정렬
    if (accountingData.transaction.deposit) {
      const sortedDeposit = {};
      const depositDates = Object.keys(accountingData.transaction.deposit).sort((a, b) => new Date(a) - new Date(b));
      depositDates.forEach(date => {
        sortedDeposit[date] = accountingData.transaction.deposit[date];
      });
      accountingData.transaction.deposit = sortedDeposit;
    }
  }
  
  // Notes 정렬: 날짜가 예전꺼가 위로, 나중꺼가 아래로
  if (accountingData.notes) {
    const sortedNotes = {};
    const notesDates = Object.keys(accountingData.notes).sort((a, b) => new Date(a) - new Date(b));
    notesDates.forEach(date => {
      sortedNotes[date] = accountingData.notes[date];
    });
    accountingData.notes = sortedNotes;
    
    // Notes 내부의 nuintek과 sungmoon 데이터도 날짜별로 정렬
    if (accountingData.notes.nuintek) {
      const sortedNuintek = {};
      const nuintekDates = Object.keys(accountingData.notes.nuintek).sort((a, b) => new Date(a) - new Date(b));
      nuintekDates.forEach(date => {
        sortedNuintek[date] = accountingData.notes.nuintek[date];
      });
      accountingData.notes.nuintek = sortedNuintek;
    }
    
    if (accountingData.notes.sungmoon) {
      const sortedSungmoon = {};
      const sungmoonDates = Object.keys(accountingData.notes.sungmoon).sort((a, b) => new Date(a) - new Date(b));
      sungmoonDates.forEach(date => {
        sortedSungmoon[date] = accountingData.notes.sungmoon[date];
      });
      accountingData.notes.sungmoon = sortedSungmoon;
    }
  }
  
  // LoanTo 정렬: 날짜가 예전꺼가 위로, 나중꺼가 아래로
  if (accountingData.loanto) {
    const sortedLoanto = {};
    const loantoDates = Object.keys(accountingData.loanto).sort((a, b) => new Date(a) - new Date(b));
    loantoDates.forEach(date => {
      sortedLoanto[date] = accountingData.loanto[date];
    });
    accountingData.loanto = sortedLoanto;
  }
  
  // Debt 정렬: 날짜가 예전꺼가 위로, 나중꺼가 아래로
  if (accountingData.debt) {
    const sortedDebt = {};
    const debtDates = Object.keys(accountingData.debt).sort((a, b) => new Date(a) - new Date(b));
    debtDates.forEach(date => {
      sortedDebt[date] = accountingData.debt[date];
    });
    accountingData.debt = sortedDebt;
  }
}

// Accounting 데이터 불러오기 API (balance 배열 내 날짜별 데이터)
app.get('/api/accounting', (req, res) => {
  try {
    const { date, previousDay } = req.query;
    
    // 전날 데이터 요청 (가장 최근 데이터 찾기)
    if (previousDay === 'true' && date) {
      const result = [];
      if (accountingStore.balance && Array.isArray(accountingStore.balance)) {
        accountingStore.balance.forEach(item => {
          if (item.balances) {
            // 해당 계좌의 모든 날짜를 가져와서 정렬
            const availableDates = Object.keys(item.balances)
              .filter(dateStr => dateStr < date) // 현재 날짜보다 이전 날짜만
              .sort((a, b) => new Date(b) - new Date(a)); // 최신순 정렬
            
            if (availableDates.length > 0) {
              // 가장 최근 날짜의 잔액 사용
              const latestDate = availableDates[0];
              result.push({
                name: item.name,
                bank: item.bank,
                balance: item.balances[latestDate]
              });
            }
          }
        });
      }
      res.json(result);
    }
    // 특정 날짜의 데이터만 반환
    else if (date) {
      const result = [];
      if (accountingStore.balance && Array.isArray(accountingStore.balance)) {
        accountingStore.balance.forEach(item => {
          if (item.balances && item.balances[date] !== undefined) {
            result.push({
              name: item.name,
              bank: item.bank,
              balance: item.balances[date]
            });
          }
        });
      }
      res.json(result);
    } else {
      // 전체 데이터 반환
      res.json(accountingStore);
    }
  } catch (error) {
    res.status(500).json({ error: '데이터 로드 중 오류가 발생했습니다.' });
  }
});

// 통합된 Accounting 데이터 저장 API
app.post('/api/accounting', (req, res) => {
  try {
    const { category, data } = req.body;
    
    if (!category || !data) {
      return res.status(400).json({ error: '카테고리와 데이터가 필요합니다.' });
    }
    
    // accountingStore 초기화 확인
    if (!accountingStore.balance) {
      accountingStore.balance = [];
    }
    if (!accountingStore.transaction) {
      accountingStore.transaction = { deposit: {}, withdrawal: {} };
    }
    
    let result = { success: true, message: '', addedItems: 0, updatedItems: 0 };
    
    if (category === 'balance') {
      // Balance 데이터 저장
      const { name, bank, date, balance } = data;
      
      if (!name || !bank || !date || balance === undefined) {
        return res.status(400).json({ error: 'name, bank, date, balance가 필요합니다.' });
      }
      
      // balance 배열 초기화
      if (!accountingStore.balance) {
        accountingStore.balance = [];
      }
      
      // 기존 항목 찾기
      let existingItem = accountingStore.balance.find(item => 
        item.name === name && item.bank === bank
      );
      
      if (!existingItem) {
        // 새 항목 생성
        existingItem = {
          name: name,
          bank: bank,
          balances: {}
        };
        accountingStore.balance.push(existingItem);
        result.addedItems = 1;
      }
      
      // 해당 날짜의 balance 저장
      existingItem.balances[date] = balance;
      result.message = `${date} 날짜의 Balance 데이터가 저장되었습니다.`;
      
    } else if (category === 'transaction') {
      // Transaction 데이터 저장
      const { type, date, items } = data;
      
      if (!type || !date || !items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'type, date, items가 필요합니다.' });
      }
      
      // transaction 구조 초기화
      if (!accountingStore.transaction) {
        accountingStore.transaction = {};
      }
      if (!accountingStore.transaction[type]) {
        accountingStore.transaction[type] = {};
      }
      
      // 해당 날짜의 기존 데이터 가져오기
      const existingItems = accountingStore.transaction[type][date] || [];
      let addedCount = 0;
      let updatedCount = 0;
      
      // 각 항목에 대해 중복 체크 및 처리
      items.forEach(newItem => {
        // description이 없거나 빈 문자열이면 건너뛰기
        if (!newItem.description || typeof newItem.description !== 'string' || newItem.description.trim() === '') {
          return;
        }
        
        // description 정규화 (trim, 공백 정리)
        const normalizedDescription = newItem.description.trim();
        newItem.description = normalizedDescription;
        
        let existingIndex = -1;
        
        if (type === 'deposit') {
          // deposit: 날짜 + name + description으로 중복 체크
          const normalizedName = (newItem.name || '').trim();
          existingIndex = existingItems.findIndex(item => {
            const itemName = (item.name || '').trim();
            const itemDescription = (item.description || '').trim();
            return itemName === normalizedName && itemDescription === normalizedDescription;
          });
        } else if (type === 'withdrawal') {
          // withdrawal: description으로 중복 체크 (같은 날짜 내에서)
          // 기존 데이터의 description도 정규화하여 비교
          existingIndex = existingItems.findIndex(item => {
            const itemDescription = (item.description || '').trim();
            return itemDescription === normalizedDescription;
          });
        }
        
        if (existingIndex !== -1) {
          // 중복된 항목이 있으면 업데이트
          if (type === 'deposit') {
            // deposit: amount만 업데이트
            existingItems[existingIndex].amount = newItem.amount;
          } else if (type === 'withdrawal') {
            // withdrawal: name, amount, disabled 업데이트
            existingItems[existingIndex].name = newItem.name || '';
            existingItems[existingIndex].amount = newItem.amount;
            existingItems[existingIndex].description = normalizedDescription; // description도 정규화하여 저장
            if (newItem.disabled !== undefined) {
              existingItems[existingIndex].disabled = newItem.disabled;
            }
          }
          updatedCount++;
        } else {
          // 중복된 항목이 없으면 새로 추가
          existingItems.push(newItem);
          addedCount++;
        }
      });
      
      // 업데이트된 데이터 저장
      accountingStore.transaction[type][date] = existingItems;
      result.addedItems = addedCount;
      result.updatedItems = updatedCount;
      result.message = `${date} 날짜의 ${type}: ${addedCount}개 항목 추가, ${updatedCount}개 항목 수정`;
      
    } else if (category === 'notes') {
      // Notes 데이터 저장 (카테고리 3)
      const { company, date, data: notesData } = data;
      
      if (!company || !date || !notesData || !Array.isArray(notesData)) {
        return res.status(400).json({ error: 'company, date, data가 필요합니다.' });
      }
      
      // notes 구조 초기화
      if (!accountingStore.notes) {
        accountingStore.notes = {};
      }
      if (!accountingStore.notes[company]) {
        accountingStore.notes[company] = {};
      }
      
      // 해당 날짜의 기존 데이터 가져오기
      const existingData = accountingStore.notes[company][date] || [];
      let addedCount = 0;
      let updatedCount = 0;
      
      // 각 항목에 대해 중복 체크 및 처리
      notesData.forEach(newItem => {
        let existingIndex = -1;
        
        // deliveryNo로 중복 체크
        existingIndex = existingData.findIndex(item => 
          item.deliveryNo === newItem.deliveryNo
        );
        
        if (existingIndex !== -1) {
          // 중복된 항목이 있으면 업데이트
          existingData[existingIndex] = newItem;
          updatedCount++;
        } else {
          // 중복된 항목이 없으면 새로 추가
          existingData.push(newItem);
          addedCount++;
        }
      });
      
      // 업데이트된 데이터 저장
      accountingStore.notes[company][date] = existingData;
      result.addedItems = addedCount;
      result.updatedItems = updatedCount;
      result.message = `${date} 날짜의 ${company} 데이터가 저장되었습니다. (추가: ${addedCount}, 업데이트: ${updatedCount})`;
      
    } else if (category === 'loanto') {
      // LoanTo 데이터 저장 (카테고리 4)
      const { date, data: loantoData } = data;
      
      if (!date || !loantoData || !Array.isArray(loantoData)) {
        return res.status(400).json({ error: 'date, data가 필요합니다.' });
      }
      
      // loanto 구조 초기화
      if (!accountingStore.loanto) {
        accountingStore.loanto = {};
      }
      
      // 해당 날짜의 기존 데이터 가져오기
      const existingData = accountingStore.loanto[date] || [];
      let addedCount = 0;
      let updatedCount = 0;
      
      // 각 항목에 대해 중복 체크 및 처리
      loantoData.forEach(newItem => {
        let existingIndex = -1;
        
        // company로 중복 체크
        existingIndex = existingData.findIndex(item => 
          item.company === newItem.company
        );
        
        if (existingIndex !== -1) {
          // 중복된 항목이 있으면 업데이트
          existingData[existingIndex] = newItem;
          updatedCount++;
        } else {
          // 새로운 항목이면 추가
          existingData.push(newItem);
          addedCount++;
        }
      });
      
      // 업데이트된 데이터를 저장
      accountingStore.loanto[date] = existingData;
      
      result.addedItems = addedCount;
      result.updatedItems = updatedCount;
      result.message = `${date} 날짜의 LoanTo 데이터가 저장되었습니다. (추가: ${addedCount}, 업데이트: ${updatedCount})`;
      
    } else if (category === 'debt') {
      // Debt 데이터 저장 (카테고리 5)
      const { date, data: debtData } = data;
      
      if (!date || !debtData || !Array.isArray(debtData)) {
        return res.status(400).json({ error: 'date, data가 필요합니다.' });
      }
      
      // debt 구조 초기화
      if (!accountingStore.debt) {
        accountingStore.debt = {};
      }
      
      // 해당 날짜의 기존 데이터 가져오기
      const existingData = accountingStore.debt[date] || [];
      let addedCount = 0;
      let updatedCount = 0;
      
      // 각 항목에 대해 중복 체크 및 처리
      debtData.forEach(newItem => {
        let existingIndex = -1;
        
        // company로 중복 체크
        existingIndex = existingData.findIndex(item => 
          item.company === newItem.company
        );
        
        if (existingIndex !== -1) {
          // 중복된 항목이 있으면 업데이트
          existingData[existingIndex] = newItem;
          updatedCount++;
        } else {
          // 새로운 항목이면 추가
          existingData.push(newItem);
          addedCount++;
        }
      });
      
      // 업데이트된 데이터를 저장
      accountingStore.debt[date] = existingData;
      
      result.addedItems = addedCount;
      result.updatedItems = updatedCount;
      result.message = `${date} 날짜의 Debt 데이터가 저장되었습니다. (추가: ${addedCount}, 업데이트: ${updatedCount})`;
      
    } else {
      return res.status(400).json({ error: '지원하지 않는 카테고리입니다.' });
    }
    
    // 데이터 정렬 후 서버 메모리와 하드에 저장
    sortAccountingData(accountingStore);
    fs.writeFileSync(ACCOUNTING_DATA_FILE, JSON.stringify(accountingStore, null, 2));
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '데이터 저장 중 오류가 발생했습니다.' });
  }
});

// 통합 삭제 API
app.delete('/api/accounting', (req, res) => {
  try {
    const { mode, category, name, bank } = req.body;
    
    // mode: 'by-name' - name으로 여러 카테고리에서 삭제 (기존 delete-by-name 기능)
    if (mode === 'by-name') {
    if (!name) {
      return res.status(400).json({ error: '명칭이 필요합니다.' });
    }
    
    let deleted = false;
    
    // balance 배열에서 삭제
      if (!accountingStore.balance) {
        accountingStore.balance = [];
      }
      const originalBalanceLength = accountingStore.balance.length;
      accountingStore.balance = accountingStore.balance.filter(item => item.name !== name);
      if (accountingStore.balance.length < originalBalanceLength) {
      deleted = true;
    }
    
    // loanto에서 삭제 (날짜별로 검색)
      if (accountingStore.loanto) {
        for (const date in accountingStore.loanto) {
          const originalLength = accountingStore.loanto[date].length;
          accountingStore.loanto[date] = accountingStore.loanto[date].filter(item => item.company !== name);
          if (accountingStore.loanto[date].length < originalLength) {
          deleted = true;
        }
        // 빈 배열이면 날짜 키 삭제
          if (accountingStore.loanto[date].length === 0) {
            delete accountingStore.loanto[date];
        }
      }
    }
    
    // debt에서 삭제 (날짜별로 검색)
      if (accountingStore.debt) {
        for (const date in accountingStore.debt) {
          const originalLength = accountingStore.debt[date].length;
          accountingStore.debt[date] = accountingStore.debt[date].filter(item => item.company !== name);
          if (accountingStore.debt[date].length < originalLength) {
          deleted = true;
        }
        // 빈 배열이면 날짜 키 삭제
          if (accountingStore.debt[date].length === 0) {
            delete accountingStore.debt[date];
        }
      }
    }
    
    if (!deleted) {
      return res.status(404).json({ error: '해당 명칭의 항목을 찾을 수 없습니다.' });
    }
    
      // 정렬 후 하드에 저장
      sortAccountingData(accountingStore);
      fs.writeFileSync(ACCOUNTING_DATA_FILE, JSON.stringify(accountingStore, null, 2));
      
      return res.json({ success: true, message: '항목이 삭제되었습니다.' });
    }
    
    // 기본 모드: 카테고리별 특정 항목 삭제
    if (!category) {
      return res.status(400).json({ error: '카테고리가 필요합니다.' });
    }
    
    let result = { success: false, message: '' };
    
    if (category === 'balance') {
      // Balance 데이터 삭제
      if (!name || !bank) {
        return res.status(400).json({ error: 'name과 bank가 필요합니다.' });
      }
      
      if (!accountingStore.balance) {
        return res.status(404).json({ error: 'balance 데이터가 없습니다.' });
      }
      
      const initialLength = accountingStore.balance.length;
      accountingStore.balance = accountingStore.balance.filter(item => 
        !(item.name === name && item.bank === bank)
      );
      
      if (accountingStore.balance.length < initialLength) {
        result.success = true;
        result.message = `${name} (${bank}) 계좌가 삭제되었습니다.`;
      } else {
        result.message = '삭제할 계좌를 찾을 수 없습니다.';
      }
    } else if (category === 'transaction') {
      // Transaction 데이터 삭제
      const { type, date, description } = req.body;
      
      if (!type || !date || !description) {
        return res.status(400).json({ error: 'type, date, description이 필요합니다.' });
      }
      
      if (!accountingStore.transaction) {
        return res.status(404).json({ error: 'transaction 데이터가 없습니다.' });
      }
      
      if (type === 'deposit') {
        // 입금 데이터 삭제
        if (accountingStore.transaction.deposit && accountingStore.transaction.deposit[date]) {
          const initialLength = accountingStore.transaction.deposit[date].length;
          accountingStore.transaction.deposit[date] = accountingStore.transaction.deposit[date].filter(item => 
            item.description !== description
          );
          
          if (accountingStore.transaction.deposit[date].length < initialLength) {
            result.success = true;
            result.message = `입금 거래 "${description}"이 삭제되었습니다.`;
          } else {
            result.message = '삭제할 입금 거래를 찾을 수 없습니다.';
          }
        } else {
          result.message = '해당 날짜의 입금 데이터가 없습니다.';
        }
      } else if (type === 'withdrawal') {
        // 출금 데이터 삭제
        if (accountingStore.transaction.withdrawal && accountingStore.transaction.withdrawal[date]) {
          const initialLength = accountingStore.transaction.withdrawal[date].length;
          accountingStore.transaction.withdrawal[date] = accountingStore.transaction.withdrawal[date].filter(item => 
            item.description !== description
          );
          
          if (accountingStore.transaction.withdrawal[date].length < initialLength) {
            result.success = true;
            result.message = `출금 거래 "${description}"이 삭제되었습니다.`;
          } else {
            result.message = '삭제할 출금 거래를 찾을 수 없습니다.';
          }
        } else {
          result.message = '해당 날짜의 출금 데이터가 없습니다.';
        }
      } else {
        return res.status(400).json({ error: '지원하지 않는 거래 유형입니다.' });
      }
    } else if (category === 'notes') {
      // Notes 데이터 삭제
      const { company, date, deliveryNo, dueDate } = req.body;
      
      if (!company || !date || !deliveryNo) {
        return res.status(400).json({ error: 'company, date, deliveryNo가 필요합니다.' });
      }
      
      if (!accountingStore.notes) {
        return res.status(404).json({ error: 'notes 데이터가 없습니다.' });
      }
      
      if (!accountingStore.notes[company]) {
        return res.status(404).json({ error: `${company} 데이터가 없습니다.` });
      }
      
      if (!accountingStore.notes[company][date]) {
        return res.status(404).json({ error: `${date} 날짜의 데이터가 없습니다.` });
      }
      
      const initialLength = accountingStore.notes[company][date].length;
      // deliveryNo와 dueDate 둘 다 일치해야 삭제
      accountingStore.notes[company][date] = accountingStore.notes[company][date].filter(item => {
        if (dueDate) {
          // dueDate가 제공되면 deliveryNo와 dueDate 둘 다 일치해야 함
          return !(item.deliveryNo === deliveryNo && item.dueDate === dueDate);
        } else {
          // dueDate가 없으면 기존 로직 (deliveryNo만 비교) - 하위 호환성
          return item.deliveryNo !== deliveryNo;
        }
      });
      
      if (accountingStore.notes[company][date].length < initialLength) {
        // 남은 아이템이 없으면 날짜 객체도 삭제
        if (accountingStore.notes[company][date].length === 0) {
          delete accountingStore.notes[company][date];
        }
        
        result.success = true;
        result.message = `${company}의 ${date} 날짜 ${deliveryNo}${dueDate ? ` (납부기한: ${dueDate})` : ''} 항목이 삭제되었습니다.`;
      } else {
        result.message = '삭제할 항목을 찾을 수 없습니다.';
      }
    } else {
      return res.status(400).json({ error: '지원하지 않는 카테고리입니다.' });
    }
    
    if (result.success) {
      // 정렬 후 하드에 저장
      sortAccountingData(accountingStore);
      fs.writeFileSync(ACCOUNTING_DATA_FILE, JSON.stringify(accountingStore, null, 2));
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// Accounting 데이터 날짜별 전체 삭제 API
app.delete('/api/accounting/delete-by-date', (req, res) => {
  try {
    const { date } = req.body;
    
    if (!date) {
      return res.status(400).json({ error: '날짜가 필요합니다.' });
    }
    
    let deletedCount = 0;
    let deletedCategories = [];
    
    // balance에서 해당 날짜의 데이터 삭제
    if (accountingStore.balance && Array.isArray(accountingStore.balance)) {
      accountingStore.balance.forEach(item => {
        if (item.balances && item.balances[date] !== undefined) {
          delete item.balances[date];
          deletedCount++;
        }
      });
    }
    
    // transaction에서 해당 날짜의 데이터 삭제
    if (accountingStore.transaction) {
      if (accountingStore.transaction.deposit && accountingStore.transaction.deposit[date]) {
        delete accountingStore.transaction.deposit[date];
        deletedCount++;
        deletedCategories.push('deposit');
      }
      if (accountingStore.transaction.withdrawal && accountingStore.transaction.withdrawal[date]) {
        delete accountingStore.transaction.withdrawal[date];
        deletedCount++;
        deletedCategories.push('withdrawal');
      }
    }
    
    // notes에서 해당 날짜의 데이터 삭제
    if (accountingStore.notes) {
      if (accountingStore.notes.nuintek && accountingStore.notes.nuintek[date]) {
        delete accountingStore.notes.nuintek[date];
        deletedCount++;
        deletedCategories.push('nuintek');
      }
      if (accountingStore.notes.sungmoon && accountingStore.notes.sungmoon[date]) {
        delete accountingStore.notes.sungmoon[date];
        deletedCount++;
        deletedCategories.push('sungmoon');
      }
    }
    
    // loanto에서 해당 날짜의 데이터 삭제
    if (accountingStore.loanto && accountingStore.loanto[date]) {
      delete accountingStore.loanto[date];
      deletedCount++;
      deletedCategories.push('loanto');
    }
    
    // debt에서 해당 날짜의 데이터 삭제
    if (accountingStore.debt && accountingStore.debt[date]) {
      delete accountingStore.debt[date];
      deletedCount++;
      deletedCategories.push('debt');
    }
    
    if (deletedCount === 0) {
      return res.status(404).json({ error: '해당 날짜의 데이터가 없습니다.' });
    }
    
    // 정렬 후 하드에 저장
    sortAccountingData(accountingStore);
    fs.writeFileSync(ACCOUNTING_DATA_FILE, JSON.stringify(accountingStore, null, 2));
    
    res.json({ 
      success: true, 
      message: `${date} 날짜의 데이터가 삭제되었습니다.`,
      deletedCount,
      deletedCategories
    });
  } catch (error) {
    res.status(500).json({ error: '데이터 삭제 중 오류가 발생했습니다.' });
  }
});

//===================================================
// 세무자료 (taxreport.html)
//===================================================
// 파일 목록 조회: GET /api/listFiles/tax/{year}/{headerName}/{rowName} (세무자료를 tax로 변경)
app.get('/api/listFiles/tax/:year/:headerName/:rowName', (req, res) => {
  try {
    const { year, headerName, rowName } = req.params;
    const decodedHeaderName = decodeURIComponent(headerName);
    const decodedRowName = decodeURIComponent(rowName);
    const dirPath = path.join(UPLOAD_DIR, '세무자료', year, decodedHeaderName, decodedRowName);
    
    if (!fs.existsSync(dirPath)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(dirPath).map(filename => {
      const stats = fs.statSync(path.join(dirPath, filename));
      return {
        filename,
        size: stats.size,
        uploadDate: stats.mtime.toISOString()
      };
    });
    
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: '파일 목록 조회 중 오류가 발생했습니다.' });
  }
});

// 파일 미리보기: GET /api/previewFile/tax/{year}/{headerName}/{rowName}/{filename} (세무자료를 tax로 변경)
app.get('/api/previewFile/tax/:year/:headerName/:rowName/:filename', (req, res) => {
  try {
    const { year, headerName, rowName, filename } = req.params;
    const decodedHeaderName = decodeURIComponent(headerName);
    const decodedRowName = decodeURIComponent(rowName);
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, '세무자료', year, decodedHeaderName, decodedRowName, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    // 파일 확장자 확인
    const ext = path.extname(decodedFilename).toLowerCase();
    
    if (['.pdf', '.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
      // Content-Type 매핑
      const contentType = ext === '.pdf' ? 'application/pdf' :
                        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                        ext === '.png' ? 'image/png' : 'image/gif';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(decodedFilename)}`);
      res.sendFile(filePath);
    } else {
      res.status(400).json({ error: '미리보기 불가능한 파일 형식입니다.' });
    }
  } catch (error) {
    res.status(500).json({ error: '파일 미리보기 중 오류가 발생했습니다.' });
  }
});

// 파일 다운로드: GET /api/downloadFile/tax/{year}/{headerName}/{rowName}/{filename} (세무자료를 tax로 변경)
app.get('/api/downloadFile/tax/:year/:headerName/:rowName/:filename', (req, res) => {
  try {
    const { year, headerName, rowName, filename } = req.params;
    const decodedHeaderName = decodeURIComponent(headerName);
    const decodedRowName = decodeURIComponent(rowName);
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, '세무자료', year, decodedHeaderName, decodedRowName, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    res.download(filePath, decodedFilename);
  } catch (error) {
    res.status(500).json({ error: '파일 다운로드 중 오류가 발생했습니다.' });
  }
});

// 파일 삭제: DELETE /api/deleteFile/tax/{year}/{headerName}/{rowName}/{filename} (세무자료를 tax로 변경)
app.delete('/api/deleteFile/tax/:year/:headerName/:rowName/:filename', (req, res) => {
  try {
    const { year, headerName, rowName, filename } = req.params;
    const decodedHeaderName = decodeURIComponent(headerName);
    const decodedRowName = decodeURIComponent(rowName);
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(UPLOAD_DIR, '세무자료', year, decodedHeaderName, decodedRowName, decodedFilename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    fs.unlinkSync(filePath);
    res.json({ success: true, message: '파일이 성공적으로 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '파일 삭제 중 오류가 발생했습니다.' });
  }
});

//===================================================
// admin 페이지용 API
//===================================================

// JSON 파일 직접 저장 API (admin 페이지용)
app.post('/api/admin/save-json', (req, res) => {
  try {
    const { fileName, data } = req.body;
    
    if (!fileName || !data) {
      return res.status(400).json({ error: 'fileName과 data가 필요합니다.' });
    }
    
    let filePath;
    
    switch (fileName) {
      case 'priceData.json':
        filePath = DATA_FILE;
        priceStore = data;
        break;
      case 'orderData.json':
        filePath = ORDER_DATA_FILE;
        orderStore = data;
        orderStore = sortOrderStore(orderStore);
        break;
      case 'creditnote.json':
        filePath = CREDIT_NOTE_FILE;
        creditNoteStore = data;
        break;
      case 'transfer.json':
        filePath = TRANSFER_DATA_FILE;
        transferStore = data;
        break;
      case 'calendar.json':
        filePath = CALENDAR_DATA_FILE;
        calendarStore = data;
        calendarStore = sortCalendarData(calendarStore);
        break;
      case 'accounting.json':
        filePath = ACCOUNTING_DATA_FILE;
        accountingStore = data;
        accountingStore = sortAccountingData(accountingStore);
        break;
      default:
        return res.status(400).json({ error: '지원하지 않는 파일입니다.' });
    }
    
    // 파일 저장
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    
    res.json({ success: true, message: `${fileName}이(가) 저장되었습니다.` });
  } catch (error) {
    res.status(500).json({ error: 'JSON 저장 중 오류가 발생했습니다.', details: error.message });
  }
});

// JSON 파일 업로드 API (admin 페이지용)
app.post('/api/admin/upload-json', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 선택되지 않았습니다.' });
    }
    
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ error: 'fileName이 필요합니다.' });
    }
    
    // 파일 내용을 JSON으로 파싱
    const fileContent = req.file.buffer.toString('utf8');
    const jsonData = JSON.parse(fileContent);
    
    // save-json API와 동일한 로직 사용
    let filePath;
    
    let dataToSave = jsonData;
    
    switch (fileName) {
      case 'priceData.json':
        filePath = DATA_FILE;
        priceStore = jsonData;
        break;
      case 'orderData.json':
        filePath = ORDER_DATA_FILE;
        orderStore = jsonData;
        orderStore = sortOrderStore(orderStore);
        dataToSave = orderStore;
        break;
      case 'creditnote.json':
        filePath = CREDIT_NOTE_FILE;
        creditNoteStore = jsonData;
        break;
      case 'transfer.json':
        filePath = TRANSFER_DATA_FILE;
        transferStore = jsonData;
        break;
      case 'calendar.json':
        filePath = CALENDAR_DATA_FILE;
        calendarStore = sortCalendarData(jsonData);
        dataToSave = calendarStore;
        break;
      case 'accounting.json':
        filePath = ACCOUNTING_DATA_FILE;
        accountingStore = jsonData;
        sortAccountingData(accountingStore);
        dataToSave = accountingStore;
        break;
      default:
        return res.status(400).json({ error: '지원하지 않는 파일입니다.' });
    }
    
    // 파일 저장 (정렬된 데이터 저장)
    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
    
    res.json({ success: true, message: `${fileName}이(가) 업로드되었습니다.` });
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'JSON 파일 형식이 올바르지 않습니다.', details: error.message });
    } else {
      res.status(500).json({ error: 'JSON 업로드 중 오류가 발생했습니다.', details: error.message });
    }
  }
});

// 서버 재시동 API (Railway에서는 자동 배포가 되므로 안내만)
app.post('/api/admin/restart', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Railway에서는 GitHub push 후 자동 배포가 진행됩니다.',
    note: '로컬 서버의 경우 수동으로 재시동해주세요.'
  });
});

// uploads 폴더 탐색 API
app.get('/api/admin/explore-uploads', (req, res) => {
  try {
    const { path: relativePath } = req.query;
    const targetPath = relativePath 
      ? path.join(UPLOAD_DIR, relativePath)
      : UPLOAD_DIR;
    
    // 보안: UPLOAD_DIR 밖으로 나가는 경로 차단
    const resolvedPath = path.resolve(targetPath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return res.status(403).json({ error: '접근이 거부되었습니다.' });
    }
    
    if (!fs.existsSync(targetPath)) {
      return res.json({ folders: [], files: [] });
    }
    
    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: '폴더가 아닙니다.' });
    }
    
    const items = fs.readdirSync(targetPath);
    const folders = [];
    const files = [];
    
    items.forEach(item => {
      // .DS_Store 및 기타 숨김 파일 제외
      if (item.startsWith('.')) {
        return;
      }
      
      const itemPath = path.join(targetPath, item);
      const itemStats = fs.statSync(itemPath);
      
      if (itemStats.isDirectory()) {
        folders.push({
          name: item,
          path: relativePath ? `${relativePath}/${item}` : item
        });
      } else {
        files.push({
          name: item,
          path: relativePath ? `${relativePath}/${item}` : item,
          size: itemStats.size,
          modified: itemStats.mtime.toISOString()
        });
      }
    });
    
    // 폴더와 파일을 이름순으로 정렬
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    
    res.json({ folders, files, currentPath: relativePath || '' });
  } catch (error) {
    res.status(500).json({ error: '폴더 탐색 중 오류가 발생했습니다.', details: error.message });
  }
});

// uploads 파일 미리보기/다운로드 API
// 파일 삭제: DELETE /api/admin/delete-upload-file
app.delete('/api/admin/delete-upload-file', (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: 'filePath가 필요합니다.' });
    }
    
    const targetPath = path.join(UPLOAD_DIR, filePath);
    
    // 보안: UPLOAD_DIR 밖으로 나가는 경로 차단
    const resolvedPath = path.resolve(targetPath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return res.status(403).json({ error: '접근이 거부되었습니다.' });
    }
    
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: '파일이 아닙니다.' });
    }
    
    // 파일 삭제
    fs.unlinkSync(targetPath);
    
    // 파일이 있던 폴더 경로
    const fileDir = path.dirname(targetPath);
    
    // 폴더가 비어있는지 확인하고, 비어있으면 삭제
    try {
      const dirContents = fs.readdirSync(fileDir);
      if (dirContents.length === 0) {
        fs.rmdirSync(fileDir);
        
        // 상위 폴더도 확인 (UPLOAD_DIR까지)
        let currentDir = fileDir;
        const resolvedUploadDir = path.resolve(UPLOAD_DIR);
        
        while (true) {
          const parentDir = path.dirname(currentDir);
          const resolvedParentDir = path.resolve(parentDir);
          
          // UPLOAD_DIR에 도달하거나 밖으로 나가면 중단
          if (resolvedParentDir === resolvedUploadDir || !resolvedParentDir.startsWith(resolvedUploadDir)) {
            break;
          }
          
          // 현재 디렉토리가 부모와 같으면 루트에 도달한 것이므로 중단
          if (resolvedParentDir === path.resolve(currentDir)) {
            break;
          }
          
          try {
            const parentContents = fs.readdirSync(parentDir);
            if (parentContents.length === 0) {
              fs.rmdirSync(parentDir);
              currentDir = parentDir;
            } else {
              break;
            }
          } catch (err) {
            // 폴더가 없거나 삭제할 수 없으면 중단
            break;
          }
        }
      }
    } catch (dirError) {
      // 폴더 확인/삭제 실패는 무시 (파일 삭제는 성공했으므로)
    }
    
    res.json({ success: true, message: '파일이 성공적으로 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ error: '파일 삭제 중 오류가 발생했습니다.', details: error.message });
  }
});

app.get('/api/admin/preview-upload-file', (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: 'filePath가 필요합니다.' });
    }
    
    const targetPath = path.join(UPLOAD_DIR, filePath);
    
    // 보안: UPLOAD_DIR 밖으로 나가는 경로 차단
    const resolvedPath = path.resolve(targetPath);
    const resolvedUploadDir = path.resolve(UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      return res.status(403).json({ error: '접근이 거부되었습니다.' });
    }
    
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: '파일이 아닙니다.' });
    }
    
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.txt': 'text/plain',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }[ext] || 'application/octet-stream';
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(path.basename(targetPath))}"`);
    res.sendFile(targetPath);
  } catch (error) {
    res.status(500).json({ error: '파일 미리보기 중 오류가 발생했습니다.', details: error.message });
  }
});

// 서버 시작
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
