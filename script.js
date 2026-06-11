// ==========================================
// 1. ИМПОРТ МОДУЛЕЙ FIREBASE (ОБЛАКО)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment, onSnapshot, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ==========================================
// 2. КОНФИГУРАЦИЯ И ИНИЦИАЛИЗАЦИЯ FB
// ==========================================
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

// Глобальный буфер обмена для работы между листами
let globalClipboardData = null;

// Получение или генерация анонимного ID для голосования без учетки
if (!localStorage.getItem('anonymous_vote_id')) {
    localStorage.setItem('anonymous_vote_id', 'anon_' + Math.random().toString(36).substring(2, 15));
}
const voterId = localStorage.getItem('anonymous_vote_id');

// ==========================================
// 3. ГЛОБАЛЬНОЕ СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// ==========================================
let state = {
    user: null, 
    sheets: [], 
    currentSheetId: null,
    currentTool: 'pencil',
    currentColor: '#000000',
    adminEmails: ['7777773699alan@gmail.com'],
    voting: {
        joined: false,      
        votedFor: null      
    }
};

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

const joinVotingBtn = document.getElementById('join-voting-btn');
const skipVotingBtn = document.getElementById('skip-voting-btn');
const leaveVotingBtn = document.getElementById('leave-voting-btn');
const votingStatus = document.getElementById('voting-status');

const pencilCanvas = document.createElement('canvas');
const penCanvas = document.createElement('canvas');
const pCtx = pencilCanvas.getContext('2d');
const penCtx = penCanvas.getContext('2d');
[pencilCanvas, penCanvas].forEach(c => { c.width = 800; c.height = 600; });

function getTodayDateString() {
    const today = new Date();
    return today.toISOString().split('T')[0]; 
}

// ==========================================
// 5. ЛОГИКА РАБОТЫ С БАЗОЙ ДАННЫХ
// ==========================================

async function initializeSheetsInDB() {
    const todayStr = getTodayDateString();
    const metaRef = doc(db, "system", "voting_metadata");
    
    let lastActiveDate = "";
    try {
        const metaSnap = await getDoc(metaRef);
        if (metaSnap.exists()) {
            lastActiveDate = metaSnap.data().lastDate;
        }
    } catch(e) { 
        console.log("Первый запуск метаданных"); 
    }
    
    const sheetsRef = collection(db, "sheets");
    const snapshot = await getDocs(sheetsRef);
    
    if (lastActiveDate !== todayStr || snapshot.size <= 1) { 
        console.log("Новый день или пустая база! Обнуляем голоса до 0...");
        for (let i = 1; i <= 10; i++) {
            const docRef = doc(db, "sheets", `sheet_${i}`);
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                await updateDoc(docRef, { votes: 0 });
            } else {
                await setDoc(docRef, {
                    id: i,
                    pencilData: "", 
                    penData: "",
                    lastModifiedBy: "Система",
                    lastModifiedTime: "00:00",
                    votes: 0
                });
            }
        }
        await setDoc(metaRef, { lastDate: todayStr });
    }
}

function startListeningToSheets() {
    onSnapshot(collection(db, "sheets"), (snapshot) => {
        let updatedSheets = [];
        snapshot.forEach((doc) => {
            if(doc.id !== 'init') { 
                updatedSheets.push(doc.data());
            }
        });
        
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
        card.id = `sheet_${sheet.id}`;
        
        if (state.voting.joined) card.classList.add('active-voting');
        if (state.voting.votedFor === `sheet_${sheet.id}`) card.classList.add('my-vote');
        
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
        editBtn.onclick = (e) => {
            e.stopPropagation(); 
            openEditor(sheet.id);
        };
        card.appendChild(editBtn);

        const voteBox = document.createElement('div');
        voteBox.className = 'vote-section';
        voteBox.innerHTML = `<span>Голосов: ${sheet.votes || 0}</span>`;
        card.appendChild(voteBox);

        const meta = document.createElement('div');
        meta.className = 'sheet-meta';
        meta.innerHTML = `Изменил: ${sheet.lastModifiedBy}<br>Время: ${sheet.lastModifiedTime}`;
        card.appendChild(meta);

        card.onclick = () => handleVote(`sheet_${sheet.id}`);

        sheetsContainer.appendChild(card);
    });
}

function updateMainCanvas() {
    ctx.clearRect(0,0,800,600);
    ctx.drawImage(pencilCanvas, 0, 0);
    ctx.drawImage(penCanvas, 0, 0);
}

// ==========================================
// 7. СИСТЕМА АВТОРИЗАЦИИ И ГОЛОСОВАНИЯ
// ==========================================

onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
        const currentUserEmail = firebaseUser.email.toLowerCase();
        const checkAdmin = state.adminEmails.map(email => email.toLowerCase()).includes(currentUserEmail);

        state.user = {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            isAdmin: checkAdmin
        };
        
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        usernameSpan.innerText = firebaseUser.email;
        
        if(state.user.isAdmin) {
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
            document.getElementById('admin-badge').classList.remove('hidden');
        } else {
            document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
            document.getElementById('admin-badge').classList.add('hidden');
        }
    } else {
        state.user = null;
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
        document.getElementById('admin-badge').classList.add('hidden');
    }
    
    // Подгружаем статус голосования (привязано к VoterId, работает и без аккаунта)
    const todayStr = getTodayDateString();
    const voteSnap = await getDoc(doc(db, "votes", voterId));
    
    if (voteSnap.exists() && voteSnap.data().date === todayStr) {
        state.voting.joined = true;
        state.voting.votedFor = voteSnap.data().sheetId;
        joinVotingBtn.classList.add('hidden');
        leaveVotingBtn.classList.remove('hidden');
        skipVotingBtn.classList.remove('hidden');
        
        if(state.voting.votedFor === "none") {
            votingStatus.innerText = "Вы проголосовали за никого. Выберите лист из списка, если передумаете!";
        } else {
            const sheetNumber = state.voting.votedFor.replace("sheet_", "");
            votingStatus.innerText = `Вы участвуете. Ваш выбор: Лист #${sheetNumber}. Кликни на другой лист, чтобы изменить выбор.`;
        }
    } else {
        joinVotingBtn.classList.remove('hidden');
        leaveVotingBtn.classList.add('hidden');
        skipVotingBtn.classList.add('hidden');
        votingStatus.innerText = "Голосование доступно всем! Нажмите кнопку, чтобы начать.";
    }

    await initializeSheetsInDB();
    startListeningToSheets(); 
});

loginBtn.onclick = async () => {
    try { await signInWithPopup(auth, provider); } catch (error) { console.error("Ошибка входа Google:", error); }
};

usernameSpan.style.cursor = "pointer";
usernameSpan.onclick = () => {
    if(confirm("Вы хотите выйти из аккаунта?")) signOut(auth);
};

/* КНОПКА УЧАСТВОВАТЬ */
joinVotingBtn.onclick = () => {
    state.voting.joined = true;
    joinVotingBtn.classList.add('hidden');
    leaveVotingBtn.classList.remove('hidden');
    skipVotingBtn.classList.remove('hidden');
    votingStatus.innerText = "Вы в игре! Выберите любой лист или скипните выбор.";
    renderSheetsGrid(); 
};

/* КНОПКА ВЫЙТИ ИЗ РЕЖИМА ГОЛОСОВАНИЯ (ГОЛОС СОХРАНЯЕТСЯ) */
leaveVotingBtn.onclick = () => {
    state.voting.joined = false;
    leaveVotingBtn.classList.add('hidden');
    skipVotingBtn.classList.add('hidden');
    joinVotingBtn.classList.remove('hidden');
    votingStatus.innerText = "Режим голосования закрыт. Ваш текущий голос сохранён в базе!";
    renderSheetsGrid();
};

/* КНОПКА ПРОГОЛОСОВАТЬ ЗА НИКОГО (СКИП) */
skipVotingBtn.onclick = async () => {
    if (!state.voting.joined) return;
    if (state.voting.votedFor === "none") return alert("Вы уже проголосовали за никого!");

    const todayStr = getTodayDateString();
    const voteDocRef = doc(db, "votes", voterId);

    try {
        if (state.voting.votedFor && state.voting.votedFor !== "none") {
            await updateDoc(doc(db, "sheets", state.voting.votedFor), { votes: increment(-1) });
        }
        await setDoc(voteDocRef, { sheetId: "none", date: todayStr });
        state.voting.votedFor = "none";
        votingStatus.innerText = "Вы выбрали вариант 'Ни за кого'. Старые голоса списаны.";
        renderSheetsGrid();
    } catch (e) {
        console.error(e);
    }
};

async function handleVote(sheetId) {
    if (!state.voting.joined) return alert("Нажмите кнопку 'Участвовать в голосовании' в шапке сайта!");
    if (state.voting.votedFor === sheetId) return; 

    const todayStr = getTodayDateString();
    const voteDocRef = doc(db, "votes", voterId);
    const targetSheetNumber = sheetId.replace("sheet_", "");

    try {
        if (state.voting.votedFor === null) {
            await updateDoc(doc(db, "sheets", sheetId), { votes: increment(1) });
            await setDoc(voteDocRef, { sheetId: sheetId, date: todayStr });
            state.voting.votedFor = sheetId;
            votingStatus.innerText = `Голос принят за Лист #${targetSheetNumber}! Можно изменить выбор кликом на другой лист.`;
        } else {
            const oldSheetId = state.voting.votedFor;
            if (oldSheetId !== "none") {
                const oldSheetNumber = oldSheetId.replace("sheet_", "");
                await updateDoc(doc(db, "sheets", oldSheetId), { votes: increment(-1) });
                votingStatus.innerText = `Вы передумали! Голос перенесён с Листа #${oldSheetNumber} на Лист #${targetSheetNumber}.`;
            } else {
                votingStatus.innerText = `Голос принят за Лист #${targetSheetNumber}!`;
            }
            
            await updateDoc(doc(db, "sheets", sheetId), { votes: increment(1) });
            await setDoc(voteDocRef, { sheetId: sheetId, date: todayStr });
            state.voting.votedFor = sheetId;
        }
    } catch (error) {
        console.error(error);
        alert("Ошибка отправки голоса.");
    }
}

// ==========================================
// 8. ДВИЖОК РИСОВАНИЯ (PAINT ENGINE) + УМНАЯ ЗАЛИВКА
// ==========================================

// Алгоритм правильной заливки замкнутых областей (Flood Fill)
function floodFill(canvasElement, startX, startY, fillColor) {
    const context = canvasElement.getContext('2d');
    const imageWidth = canvasElement.width;
    const imageHeight = canvasElement.height;
    
    const imageData = context.getImageData(0, 0, imageWidth, imageHeight);
    const rawPixels = imageData.data;

    const targetPos = (startY * imageWidth + startX) * 4;
    const startR = rawPixels[targetPos];
    const startG = rawPixels[targetPos + 1];
    const startB = rawPixels[targetPos + 2];
    const startA = rawPixels[targetPos + 3];

    // Конвертируем HEX цвет заливки в RGBA структуру
    const fillComponents = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fillColor);
    const fillR = parseInt(fillComponents[1], 16);
    const fillG = parseInt(fillComponents[2], 16);
    const fillB = parseInt(fillComponents[3], 16);
    const fillA = 255;

    // Если цвета совпадают, заливать не нужно
    if (startR === fillR && startG === fillG && startB === fillB && startA === fillA) return;

    const matchColor = (pos) => {
        return rawPixels[pos] === startR && 
               rawPixels[pos + 1] === startG && 
               rawPixels[pos + 2] === startB && 
               rawPixels[pos + 3] === startA;
    };

    const colorPixel = (pos) => {
        rawPixels[pos] = fillR;
        rawPixels[pos + 1] = fillG;
        rawPixels[pos + 2] = fillB;
        rawPixels[pos + 3] = fillA;
    };

    let pixelQueue = [[startX, startY]];

    while (pixelQueue.length > 0) {
        let currentPoint = pixelQueue.pop();
        let curX = currentPoint[0];
        let curY = currentPoint[1];

        let currentPos = (curY * imageWidth + curX) * 4;

        while (curY >= 0 && matchColor(currentPos)) {
            curY--;
            currentPos -= imageWidth * 4;
        }

        currentPos += imageWidth * 4;
        curY++;

        let checkLeft = false;
        let checkRight = false;

        while (curY < imageHeight && matchColor(currentPos)) {
            colorPixel(currentPos);

            if (curX > 0) {
                if (matchColor(currentPos - 4)) {
                    if (!checkLeft) {
                        pixelQueue.push([curX - 1, curY]);
                        checkLeft = true;
                    }
                } else if (checkLeft) {
                    checkLeft = false;
                }
            }

            if (curX < imageWidth - 1) {
                if (matchColor(currentPos + 4)) {
                    if (!checkRight) {
                        pixelQueue.push([curX + 1, curY]);
                        checkRight = true;
                    }
                } else if (checkRight) {
                    checkRight = false;
                }
            }

            curY++;
            currentPos += imageWidth * 4;
        }
    }
    context.putImageData(imageData, 0, 0);
}

function openEditor(id) {
    state.currentSheetId = id;
    document.getElementById('current-sheet-title').innerText = `Редактирование Листа #${id}`;
    
    pCtx.clearRect(0,0,800,600);
    penCtx.clearRect(0,0,800,600);
    pCtx.fillStyle = '#ffffff'; pCtx.fillRect(0,0,800,600);

    let sheet = state.sheets.find(s => s.id === id);
    
    if(sheet.pencilData) { let img = new Image(); img.src = sheet.pencilData; img.onload = () => { pCtx.drawImage(img,0,0); updateMainCanvas(); } }
    if(sheet.penData) { let img = new Image(); img.src = sheet.penData; img.onload = () => { penCtx.drawImage(img,0,0); updateMainCanvas(); } }

    mainScreen.classList.add('hidden');
    editorScreen.classList.remove('hidden');
    
    // Если в глобальном буфере что-то есть, открываем интерфейс пасты
    if (globalClipboardData) {
        document.getElementById('clipboard-box').classList.remove('hidden');
    }
    updateMainCanvas();
}

canvas.onmousedown = (e) => {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    startX = Math.floor(e.clientX - rect.left);
    startY = Math.floor(e.clientY - rect.top);

    if(state.currentTool === 'pencil-bucket') {
        floodFill(pencilCanvas, startX, startY, state.currentColor);
        updateMainCanvas();
        isDrawing = false;
    } else if(state.currentTool === 'pen-bucket') {
        floodFill(penCanvas, startX, startY, state.currentColor);
        updateMainCanvas();
        isDrawing = false;
    }
};

canvas.onmousemove = (e) => {
    if(!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(e.clientX - rect.left);
    const y = Math.floor(e.clientY - rect.top);

    if (state.currentTool === 'pencil') {
        pCtx.lineWidth = 5; pCtx.lineCap = 'round'; pCtx.strokeStyle = state.currentColor;
        pCtx.beginPath(); pCtx.moveTo(startX, startY); pCtx.lineTo(x, y); pCtx.stroke();
        startX = x; startY = y;
        updateMainCanvas();
    } else if (state.currentTool === 'pen') {
        penCtx.lineWidth = 5; penCtx.lineCap = 'round'; penCtx.strokeStyle = state.currentColor;
        penCtx.beginPath(); penCtx.moveTo(startX, startY); pCtx.lineTo(x, y); penCtx.stroke();
        startX = x; startY = y;
        updateMainCanvas();
    } else if (state.currentTool === 'eraser') {
        pCtx.lineWidth = 20; pCtx.lineCap = 'round'; pCtx.strokeStyle = '#ffffff';
        pCtx.beginPath(); pCtx.moveTo(startX, startY); pCtx.lineTo(x, y); pCtx.stroke();
        startX = x; startY = y;
        updateMainCanvas();
    } else if (state.currentTool === 'super-eraser' && state.user?.isAdmin) {
        pCtx.lineWidth = 20; pCtx.lineCap = 'round'; pCtx.strokeStyle = '#ffffff';
        pCtx.beginPath(); pCtx.moveTo(startX, startY); pCtx.lineTo(x, y); pCtx.stroke();
        
        penCtx.save();
        penCtx.globalCompositeOperation = 'destination-out';
        penCtx.lineWidth = 20; penCtx.lineCap = 'round';
        penCtx.beginPath(); penCtx.moveTo(startX, startY); penCtx.lineTo(x, y); penCtx.stroke();
        penCtx.restore();
        startX = x; startY = y;
        updateMainCanvas();
    } else if (state.currentTool === 'select') {
        // Отрисовка рамки выделения без разрушения основных данных
        updateMainCanvas();
        ctx.strokeStyle = '#3498db'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
        ctx.strokeRect(startX, startY, x - startX, y - startY);
        ctx.setLineDash([]);
        selectionRect = { x: startX, y: startY, w: x - startX, h: y - startY };
    }
};

canvas.onmouseup = () => {
    isDrawing = false;
    if(state.currentTool === 'select' && selectionRect && Math.abs(selectionRect.w) > 2) {
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
            if(state.currentTool !== 'select' && !globalClipboardData) {
                document.getElementById('clipboard-box').classList.add('hidden');
            }
        };
    });

    document.getElementById('color-picker').onchange = (e) => { state.currentColor = e.target.value; };

    document.getElementById('back-btn').onclick = async () => {
        let now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
        
        const authorName = state.user ? state.user.email : "Аноним";
        const updatedData = {
            id: state.currentSheetId,
            pencilData: pencilCanvas.toDataURL(), 
            penData: penCanvas.toDataURL(),
            lastModifiedBy: authorName,
            lastModifiedTime: timeStr,
            votes: state.sheets.find(s => s.id === state.currentSheetId)?.votes || 0 
        };

        await setDoc(doc(db, "sheets", `sheet_${state.currentSheetId}`), updatedData);
        
        editorScreen.classList.add('hidden');
        mainScreen.classList.remove('hidden');
    };

    /* РАБОТА С КЛИПБОРДОМ (РАБОТАЕТ МЕЖДУ ЛИСТАМИ) */
    document.getElementById('copy-btn').onclick = () => {
        if(!selectionRect) return;
        
        // Создаем временный оффскрин холст для записи копируемой структуры
        const copyTempCanvas = document.createElement('canvas');
        copyTempCanvas.width = Math.abs(selectionRect.w);
        copyTempCanvas.height = Math.abs(selectionRect.h);
        const ctc = copyTempCanvas.getContext('2d');

        // Вычисляем корректные координаты с учетом направления выделения
        const sourceX = selectionRect.w < 0 ? selectionRect.x + selectionRect.w : selectionRect.x;
        const sourceY = selectionRect.h < 0 ? selectionRect.y + selectionRect.h : selectionRect.y;
        const targetW = Math.abs(selectionRect.w);
        const targetH = Math.abs(selectionRect.h);

        // Копируем склеенный холст
        ctc.drawImage(canvas, sourceX, sourceY, targetW, targetH, 0, 0, targetW, targetH);
        
        // Сохраняем в глобальный буфер
        globalClipboardData = {
            image: copyTempCanvas,
            width: targetW,
            height: targetH
        };
        
        alert("Часть рисунка скопирована в глобальный буфер! Вы можете вставить её на любой другой лист.");
    };

    document.getElementById('paste-btn').onclick = () => {
        if(!globalClipboardData) return alert("Буфер обмена пуст!");
        
        // Вставляем фрагмент по умолчанию в левый верхний угол слоя карандаша
        pCtx.drawImage(globalClipboardData.image, 50, 50);
        updateMainCanvas();
        alert("Элемент успешно импортирован на текущий лист!");
    };

    document.getElementById('delete-selection-btn').onclick = () => {
        if(!selectionRect) return;
        const sourceX = selectionRect.w < 0 ? selectionRect.x + selectionRect.w : selectionRect.x;
        const sourceY = selectionRect.h < 0 ? selectionRect.y + selectionRect.h : selectionRect.y;
        const targetW = Math.abs(selectionRect.w);
        const targetH = Math.abs(selectionRect.h);

        pCtx.fillStyle = '#ffffff';
        pCtx.fillRect(sourceX, sourceY, targetW, targetH);
        if(state.user?.isAdmin) {
            penCtx.clearRect(sourceX, sourceY, targetW, targetH);
        }
        updateMainCanvas();
    };

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
                lastModifiedBy: `Админ (${state.user ? state.user.email : "Аноним"})`,
                lastModifiedTime: "Только что",
                votes: currentVotes
            });
            alert(`Успешно скопировано на лист #${targetId}`);
        }
    };

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
        if((s.votes || 0) > maxVotes) {
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

setupEventListeners();