// ==========================================
// 1. ИМПОРТ МОДУЛЕЙ FIREBASE (ОБЛАКО)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ==========================================
// 2. КОНФИГУРАЦИЯ И ИНИЦИАЛИЗАЦИЯ FB
// ==========================================
// Замени эти заглушки на реальные ключи из твоего кабинета Firebase!
const firebaseConfig = {
    apiKey: "AIzaSyDQrS0gc18kU941W2Xxbof-ChQTZZBWv38",
    authDomain: "sahabaldich.firebaseapp.com",
    projectId: "sahabaldich",
    storageBucket: "sahabaldich.firebasestorage.app",
    messagingSenderId: "351962538384",
    appId: "1:351962538384:web:ef72e1a4f1d2c08309d315",
    measurementId: "G-VGJMT00ES8"
  };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ==========================================
// 3. ГЛОБАЛЬНОЕ СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ==========================================
let state = {
    user: null, 
    sheets: [], // Данные динамически прилетят из облака Firestore
    hasVotedToday: false,
    currentSheetId: null,
    currentTool: 'pencil',
    currentColor: '#000000',
    adminEmails: ['7777773699alan@gmail.com'] // Сюда впиши почту админа
};

// Буфер для инструмента Выделения (Копировать/Вставить)
let clipboardData = null;
let selectionRect = null;
let isDrawing = false;
let startX, startY;

// ==========================================
// 4. HTML ЭЛЕМЕНТЫ (UI)
// ==========================================
const mainScreen = document.getElementById('main-screen');
const editorScreen = document.getElementById('editor-screen');
const sheetsContainer = document.getElementById('sheets-container');
const loginBtn = document.getElementById('google-login-btn');
const userInfo = document.getElementById('user-info');
const usernameSpan = document.getElementById('username');
const canvas = document.getElementById('paint-canvas');
const ctx = canvas.getContext('2d');

// Создаем виртуальные скрытые холсты для разделения слоев рисования
const pencilCanvas = document.createElement('canvas');
const penCanvas = document.createElement('canvas');
const pCtx = pencilCanvas.getContext('2d');
const penCtx = penCanvas.getContext('2d');
[pencilCanvas, penCanvas].forEach(c => { c.width = 800; c.height = 600; });

// ==========================================
// 5. ЛОГИКА РАБОТЫ С БАЗОЙ ДАННЫХ
// ==========================================

// Первичная генерация 10 листов в облаке (если база пустая)
async function initializeSheetsInDB() {
    const sheetsRef = collection(db, "sheets");
    const snapshot = await getDocs(sheetsRef);
    
    if (snapshot.size <= 1) { 
        for (let i = 1; i <= 10; i++) {
            await setDoc(doc(db, "sheets", `sheet_${i}`), {
                id: i,
                pencilData: "", 
                penData: "",
                lastModifiedBy: "Система",
                lastModifiedTime: "00:00",
                votes: 0
            });
        }
        console.log("База данных успешно проинициализирована 10 листами!");
    }
}

// Прослушивание изменений на сервере в реальном времени
function startListeningToSheets() {
    onSnapshot(collection(db, "sheets"), (snapshot) => {
        let updatedSheets = [];
        snapshot.forEach((doc) => {
            if(doc.id !== 'init') { 
                updatedSheets.push(doc.data());
            }
        });
        
        // Сортируем листы по порядку (1-10) и обновляем экран
        state.sheets = updatedSheets.sort((a, b) => a.id - b.id);
        renderSheetsGrid();
        checkDailyVoteEnded();
    });
}

// ==========================================
// 6. СИНХРОНИЗАЦИЯ И РЕНДЕР ИНТЕРФЕЙСА
// ==========================================

function renderSheetsGrid() {
    sheetsContainer.innerHTML = '';
    state.sheets.forEach(sheet => {
        const card = document.createElement('div');
        card.className = 'sheet-card';
        
        // Создаем мини-превью листа, склеивая слои из Базы Данных
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = 800; previewCanvas.height = 600;
        previewCanvas.className = 'sheet-preview';
        const pco = previewCanvas.getContext('2d');
        pco.fillStyle = '#ffffff'; pco.fillRect(0,0,800,600);
        
        if(sheet.pencilData) {
            let img = new Image(); img.src = sheet.pencilData;
            img.onload = () => pco.drawImage(img, 0, 0);
        }
        if(sheet.penData) {
            let img = new Image(); img.src = sheet.penData;
            img.onload = () => pco.drawImage(img, 0, 0);
        }

        card.appendChild(previewCanvas);

        const title = document.createElement('h3');
        title.innerText = `Листок #${sheet.id}`;
        card.appendChild(title);

        const editBtn = document.createElement('button');
        editBtn.innerText = 'Редактировать';
        editBtn.onclick = () => openEditor(sheet.id);
        card.appendChild(editBtn);

        // Блок Голосования
        const voteBox = document.createElement('div');
        voteBox.className = 'vote-section';
        voteBox.innerHTML = `<span>Голосов: ${sheet.votes}</span>`;
        
        const voteBtn = document.createElement('button');
        voteBtn.innerText = '👍';
        voteBtn.disabled = state.hasVotedToday;
        voteBtn.onclick = async () => {
            await setDoc(doc(db, "sheets", `sheet_${sheet.id}`), {
                ...sheet,
                votes: sheet.votes + 1
            });
            state.hasVotedToday = true;
        };
        voteBox.appendChild(voteBtn);
        card.appendChild(voteBox);

        // Авторы изменений
        const meta = document.createElement('div');
        meta.className = 'sheet-meta';
        meta.innerHTML = `Изменил: ${sheet.lastModifiedBy}<br>Время: ${sheet.lastModifiedTime}`;
        card.appendChild(meta);

        sheetsContainer.appendChild(card);
    });
}

// Склеивание двух виртуальных слоев (Карандаш/Ручка) на главный экран редактора
function updateMainCanvas() {
    ctx.clearRect(0,0,800,600);
    ctx.drawImage(pencilCanvas, 0, 0);
    ctx.drawImage(penCanvas, 0, 0);
}

// ==========================================
// 7. СИСТЕМА АВТОРИЗАЦИИ (GOOGLE AUTH)
// ==========================================

onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
        state.user = {
            email: firebaseUser.email,
            isAdmin: state.adminEmails.includes(firebaseUser.email)
        };
        
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        usernameSpan.innerText = firebaseUser.email;
        
        if(state.user.isAdmin) {
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
            document.getElementById('admin-badge').classList.remove('hidden');
        }
    } else {
        state.user = null;
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
        document.getElementById('admin-badge').classList.add('hidden');
    }
    
    // Подключаем базу только после проверки сессии юзера
    await initializeSheetsInDB();
    startListeningToSheets(); 
});

loginBtn.onclick = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Ошибка входа Google:", error);
    }
};

usernameSpan.style.cursor = "pointer";
usernameSpan.onclick = () => {
    if(confirm("Вы хотите выйти из аккаунта?")) signOut(auth);
};

// ==========================================
// 8. ДВИЖОК РИСОВАНИЯ (PAINT ENGINE)
// ==========================================

function openEditor(id) {
    if (!state.user) {
        alert("Зарегистрируйтесь через Google, чтобы получить доступ к изменению листочков!");
        loginBtn.click();
        return;
    }
    state.currentSheetId = id;
    document.getElementById('current-sheet-title').innerText = `Редактирование Листа #${id}`;
    
    pCtx.clearRect(0,0,800,600);
    penCtx.clearRect(0,0,800,600);
    pCtx.fillStyle = '#ffffff'; pCtx.fillRect(0,0,800,600); // Базовый белый фон

    let sheet = state.sheets.find(s => s.id === id);
    
    if(sheet.pencilData) { let img = new Image(); img.src = sheet.pencilData; img.onload = () => { pCtx.drawImage(img,0,0); updateMainCanvas(); } }
    if(sheet.penData) { let img = new Image(); img.src = sheet.penData; img.onload = () => { penCtx.drawImage(img,0,0); updateMainCanvas(); } }

    mainScreen.classList.add('hidden');
    editorScreen.classList.remove('hidden');
    updateMainCanvas();
}

canvas.onmousedown = (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;

    if(state.currentTool === 'pencil-bucket' || state.currentTool === 'pen-bucket') {
        let targetCtx = (state.currentTool === 'pencil-bucket') ? pCtx : penCtx;
        targetCtx.fillStyle = state.currentColor;
        targetCtx.fillRect(0,0,800,600);
        updateMainCanvas();
    }
};

canvas.onmousemove = (e) => {
    if(!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state.currentTool === 'pencil') {
        pCtx.lineWidth = 5; pCtx.lineCap = 'round'; pCtx.strokeStyle = state.currentColor;
        pCtx.beginPath(); pCtx.moveTo(startX, startY); pCtx.lineTo(x, y); pCtx.stroke();
    } else if (state.currentTool === 'pen') {
        penCtx.lineWidth = 5; penCtx.lineCap = 'round'; penCtx.strokeStyle = state.currentColor;
        penCtx.beginPath(); penCtx.moveTo(startX, startY); penCtx.lineTo(x, y); penCtx.stroke();
    } else if (state.currentTool === 'eraser') {
        pCtx.lineWidth = 20; pCtx.lineCap = 'round'; pCtx.strokeStyle = '#ffffff';
        pCtx.beginPath(); pCtx.moveTo(startX, startY); pCtx.lineTo(x, y); pCtx.stroke();
    } else if (state.currentTool === 'super-eraser' && state.user?.isAdmin) {
        pCtx.lineWidth = 20; pCtx.lineCap = 'round'; pCtx.strokeStyle = '#ffffff';
        pCtx.beginPath(); pCtx.moveTo(startX, startY); pCtx.lineTo(x, y); pCtx.stroke();
        
        penCtx.save();
        penCtx.globalCompositeOperation = 'destination-out';
        penCtx.lineWidth = 20; penCtx.lineCap = 'round';
        penCtx.beginPath(); penCtx.moveTo(startX, startY); penCtx.lineTo(x, y); penCtx.stroke();
        penCtx.restore();
    } else if (state.currentTool === 'select') {
        updateMainCanvas();
        ctx.strokeStyle = '#3498db'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
        ctx.strokeRect(startX, startY, x - startX, y - startY);
        ctx.setLineDash([]);
        selectionRect = {x: startX, y: startY, w: x - startX, h: y - startY};
    }

    if(state.currentTool !== 'select') { startX = x; startY = y; }
    updateMainCanvas();
};

canvas.onmouseup = () => {
    isDrawing = false;
    if(state.currentTool === 'select') {
        document.getElementById('clipboard-box').classList.remove('hidden');
    }
};

// ==========================================
// 9. ИНСТРУМЕНТЫ И УПРАВЛЕНИЕ РЕДАКТОРОМ
// ==========================================

function setupEventListeners() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.onclick = () => {
            if(btn.classList.contains('admin-only') && !state.user?.isAdmin) return;
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            state.currentTool = btn.dataset.tool;
            btn.classList.add('active');
            if(state.currentTool !== 'select') document.getElementById('clipboard-box').classList.add('hidden');
        };
    });

    document.getElementById('color-picker').onchange = (e) => { state.currentColor = e.target.value; };

    // Кнопка сохранения изменений и отправки в Firestore
    document.getElementById('back-btn').onclick = async () => {
        let now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
        
        const updatedData = {
            id: state.currentSheetId,
            pencilData: pencilCanvas.toDataURL(), 
            penData: penCanvas.toDataURL(),
            lastModifiedBy: state.user.email,
            lastModifiedTime: timeStr,
            votes: state.sheets.find(s => s.id === state.currentSheetId)?.votes || 0 
        };

        await setDoc(doc(db, "sheets", `sheet_${state.currentSheetId}`), updatedData);
        
        editorScreen.classList.add('hidden');
        mainScreen.classList.remove('hidden');
    };

    // Буфер: Выделение, Копирование и Вставка
    document.getElementById('copy-btn').onclick = () => {
        if(!selectionRect) return;
        clipboardData = ctx.getImageData(selectionRect.x, selectionRect.y, selectionRect.w, selectionRect.h);
        alert("Выделенная часть скопирована!");
    };

    document.getElementById('paste-btn').onclick = () => {
        if(!clipboardData) return alert("Буфер пуст!");
        pCtx.putImageData(clipboardData, 50, 50); 
        updateMainCanvas();
    };

    document.getElementById('delete-selection-btn').onclick = () => {
        if(!selectionRect) return;
        pCtx.fillStyle = '#ffffff';
        pCtx.fillRect(selectionRect.x, selectionRect.y, selectionRect.w, selectionRect.h);
        if(state.user?.isAdmin) {
            penCtx.clearRect(selectionRect.x, selectionRect.y, selectionRect.w, selectionRect.h);
        }
        updateMainCanvas();
    };

    // Админские инструменты очистки/клонирования
    document.getElementById('admin-clear-sheet').onclick = async () => {
        if(!confirm("Удалить всё содержимое листа?")) return;
        pCtx.fillStyle = '#ffffff'; pCtx.fillRect(0,0,800,600);
        penCtx.clearRect(0,0,800,600);
        updateMainCanvas();
    };

    document.getElementById('admin-copy-sheet').onclick = async () => {
        let targetId = parseInt(prompt("На какой номер листа скопировать этот рисунок? (1-10)"));
        if(targetId >= 1 && targetId <= 10) {
            let currentVotes = state.sheets.find(s => s.id === targetId)?.votes || 0;
            await setDoc(doc(db, "sheets", `sheet_${targetId}`), {
                id: targetId,
                pencilData: pencilCanvas.toDataURL(),
                penData: penCanvas.toDataURL(),
                lastModifiedBy: `Админ (${state.user.email})`,
                lastModifiedTime: "Только что",
                votes: currentVotes
            });
            alert(`Успешно скопировано на лист #${targetId}`);
        }
    };

    // Управление модальным окном "Пьедестал"
    const modal = document.getElementById('pedestal-modal');
    document.getElementById('pedestal-btn').onclick = () => modal.classList.remove('hidden');
    document.querySelector('.close-modal').onclick = () => modal.classList.add('hidden');
}

// ==========================================
// 10. РИСУНОК ДНЯ И ГОЛОСОВАНИЕ
// ==========================================
function checkDailyVoteEnded() {
    let maxVotes = 0;
    let winnerSheet = null;
    let tie = false;

    state.sheets.forEach(s => {
        if(s.votes > maxVotes) {
            maxVotes = s.votes; winnerSheet = s; tie = false;
        } else if (s.votes === maxVotes && maxVotes > 0) {
            tie = true;
        }
    });

    const zone = document.getElementById('daily-winner-zone');
    if(winnerSheet && maxVotes > 0 && !tie) {
        zone.className = 'glowing-winner';
        zone.innerHTML = `<h4>🌟 Рисунок Дня (Лист #${winnerSheet.id})</h4><button id="download-winner-btn">💾 Скачать</button>`;
        
        document.getElementById('download-winner-btn').onclick = () => {
            const dlCanvas = document.createElement('canvas');
            dlCanvas.width = 800; dlCanvas.height = 600;
            const dlCtx = dlCanvas.getContext('2d');
            dlCtx.fillStyle = '#ffffff'; dlCtx.fillRect(0,0,800,600);
            
            let img1 = new Image(); img1.src = winnerSheet.pencilData;
            img1.onload = () => {
                dlCtx.drawImage(img1,0,0);
                let img2 = new Image(); img2.src = winnerSheet.penData;
                img2.onload = () => {
                    dlCtx.drawImage(img2,0,0);
                    let a = document.createElement('a');
                    a.download = `congo-leaf-of-the-day-${winnerSheet.id}.png`;
                    a.href = dlCanvas.toDataURL();
                    a.click();
                };
            };
        };
    } else {
        zone.innerHTML = '';
        zone.className = 'hidden';
    }
}

// Запуск прослушивания событий UI при загрузке документа
setupEventListeners();