/**
 * BOT v1.0 
 * by Khôi và ChatGPT =))
 */

import fetch from "node-fetch";
import fs from "fs";

// read config
const config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
const { bearerToken, telegramBotToken, intervalMinutes = 5 } = config;

// read file
const usersFile = "./users.json";
if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, "{}");
let users = JSON.parse(fs.readFileSync(usersFile, "utf8"));

const ksDir = "./kslogs";
if (!fs.existsSync(ksDir)) fs.mkdirSync(ksDir);
const getUserKsFile = (u) => {
  const f = `${ksDir}/kslog_${u}.json`;
  if (!fs.existsSync(f)) fs.writeFileSync(f, "{}");
  return f;
};

// UTILS 
const todayKey = () => new Date().toISOString().slice(0, 10);
const monthKey = () => new Date().toISOString().slice(0, 7);
const diffMinutes = (t) => (Date.now() - new Date(t.replace(" ", "T")).getTime()) / 60000;
const formatDuration = (minutes) => {
  const totalMinutes = Math.max(0, minutes);
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.floor(totalMinutes % 60);
    return mins ? `${hours}h${mins}p` : `${hours}h`;
  }
  const wholeMinutes = Math.floor(totalMinutes);
  const seconds = Math.floor((totalMinutes * 60) % 60);
  return `${wholeMinutes}p${seconds}s`;
};

async function tgSend(chatId, text, buttons = null) {
  const body = { chat_id: chatId, text, parse_mode: "Markdown" };
  if (buttons) body.reply_markup = { inline_keyboard: buttons };
  await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function tgAnswerCallback(id, text) {
  await fetch(`https://api.telegram.org/bot${telegramBotToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, text }),
  });
}

// api icool
const fetchRooms = async (store) =>
  (await (await fetch(`https://room.karaoke.com.vn/api/room/?store=${store}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  })).json())?.data?.data || [];

const fetchBill = async (store, room) =>
  await (await fetch(`https://room.karaoke.com.vn/api/receipts/?room=${room}&store=${store}`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  })).json();

// mute thong bao theo khung gio, theo user
let muteEnabled = false, muteStart = 1, muteEnd = 8;
const isMutedNow = () => {
  if (!muteEnabled) return false;
  const h = new Date().getHours();
  return muteStart < muteEnd ? h >= muteStart && h < muteEnd : h >= muteStart || h < muteEnd;
};

// tele polling
let lastUpdateId = 0;
let lastCallback = new Set();

// register lenh
async function registerBotCommands() {
  const commands = [
    { command: "register", description: "Đăng ký chi nhánh" },
    { command: "get", description: "Danh sách phòng đang mở" },
    { command: "reload", description: "Reload trạng thái phòng" },
    { command: "bill", description: "Xem hóa đơn phòng (vd: /bill205)" },
    { command: "ksat", description: "Danh sách phòng chưa khảo sát" },
    { command: "ksxong", description: "Đánh dấu khảo sát xong (vd: /ksxong205)" },
    { command: "tkeksat", description: "Thống kê khảo sát hôm nay" },
    { command: "tke", description: "Thống kê khảo sát theo tháng" },
    { command: "mute", description: "Tắt thông báo đêm /mute 1 8" },
    { command: "help", description: "Hướng dẫn sử dụng" }
  ];
  await fetch(`https://api.telegram.org/bot${telegramBotToken}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  console.log("✅ Telegram commands registered.");
}

async function pollTelegram() {
  try {
    const res = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getUpdates?offset=${lastUpdateId + 1}`);
    const data = await res.json();
    if (!data.ok) return;

    for (const upd of data.result) {
      lastUpdateId = upd.update_id;
      if (upd.callback_query) {
        const cb = upd.callback_query;
        const username = cb.from.username || cb.from.id.toString();
        const chatId = cb.message.chat.id;
        const roomCode = cb.data.replace("ksxong_", "");
        const cbKey = `${username}_${roomCode}`;
        if (lastCallback.has(cbKey)) {
          await tgAnswerCallback(cb.id, "⏳ Đã xử lý trước đó");
          continue;
        }
        lastCallback.add(cbKey);
        setTimeout(() => lastCallback.delete(cbKey), 5000);

        const ksFile = getUserKsFile(username);
        const ksLog = JSON.parse(fs.readFileSync(ksFile, "utf8"));
        const today = todayKey();
        if (!ksLog[today]) ksLog[today] = [];
        ksLog[today].push({ room: roomCode, time: new Date().toLocaleTimeString("vi-VN") });
        fs.writeFileSync(ksFile, JSON.stringify(ksLog, null, 2));

        await tgAnswerCallback(cb.id, `✅ Đã khảo sát xong phòng ${roomCode}`);
        await tgSend(chatId, `✅ *Phòng ${roomCode}* đã khảo sát xong.`);
        continue;
      }

      const msg = upd.message;
      if (!msg?.text) continue;
      const text = msg.text.trim();
      const chatId = msg.chat.id;
      const username = msg.from.username || chatId.toString();

      // dki chi nhanh
      if (text.startsWith("/register")) {
        const store = text.split(" ")[1];
        if (!store) {
          await tgSend(chatId, "💡 `/register <store_id>` — ví dụ: `/register 24`");
          continue;
        }
        users[username] = { store, chatId };
        fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
        await tgSend(chatId, `✅ Đăng ký chi nhánh *${store}* thành công!\nGiờ bạn có thể dùng các lệnh:\n/get, /bill, /ksat, /reload ...`);
        continue;
      }

      if (!users[username]) {
        await tgSend(chatId, "⚠️ Bạn chưa đăng ký chi nhánh.\nVui lòng dùng lệnh: `/register <store_id>` để bắt đầu.");
        continue;
      }

      const { store } = users[username];
      const ksFile = getUserKsFile(username);
      let ksLog = JSON.parse(fs.readFileSync(ksFile, "utf8"));
      const rooms = await fetchRooms(store);
      const branch = rooms[0]?.store_name || `Chi nhánh ${store}`;

      // nay la /help
      if (text === "/help") {
        await tgSend(chatId,
`🤖 *KSAT BOT*  
🏢 *${branch}*
━━━━━━━━━━━━━━━
📋 /get – Phòng đang mở  
💵 /bill205 – Xem hóa đơn phòng  
🎧 /ksat – Phòng chưa khảo sát  
✅ /ksxong205 – Đánh dấu KSAT  
📊 /tkeksat – Thống kê hôm nay  
📅 /tke – Thống kê tháng  
🔕 /mute 1 8 – Tắt thông báo đêm  
💡 /register 24 – Đăng ký chi nhánh`);
      }

      // get xem phong dang mo tai chi nhanh da dki
      else if (text === "/get" || text === "/reload") {
        const opened = rooms.filter(r => r.start && r.opened);
        if (!opened.length) { await tgSend(chatId, `📭 Hiện không có phòng nào mở tại *${branch}*.`); continue; }
        const msg = opened.map(r => {
          const duration = formatDuration(diffMinutes(r.start));
          return `🎤 *Phòng ${r.room_code}* (${r.type})\n🕒 ${r.start}\n⏱ ${duration}\n💰 ${r.revenue_tmp.toLocaleString()}₫`;
        }).join("\n\n");
        await tgSend(chatId, `📋 *Phòng đang mở tại ${branch}*\n\n${msg}\n\n♻️ Reload sau ${intervalMinutes} phút`);
      }

      // xem bill
      else if (text.startsWith("/bill")) {
        const code = text.replace("/bill", "").trim();
        if (!code) { await tgSend(chatId, "💡 `/bill <phòng>` (vd: `/bill205`)"); continue; }
        const bill = await fetchBill(store, code);
        const info = bill?.data?.info || {};
        const items = bill?.data?.items || [];
        if (!items.length) { await tgSend(chatId, `📭 Không có hóa đơn cho phòng ${code}.`); continue; }
        const r = rooms.find(x => x.room_code == code);
        const start = r?.start ? new Date(r.start.replace(" ","T")).toLocaleTimeString("vi-VN") : "—";
        const opened = r?.opened || "—";
        const grouped = items.map(i => `🍽️ *${i.name}* ×${i.quantity} — ${i.total.toLocaleString("vi-VN")}₫`).join("\n");
        const total = items.reduce((a,b)=>a+b.total,0).toLocaleString("vi-VN");
        await tgSend(chatId,
`🎉 *Phòng ${code}* (${r?.type || "?"})
🏢 *${branch}*
🕒 Giờ mở phòng: ${start}
⏱ Đã hát được: ${opened}
👨‍🦰 Nam: ${info.male ?? 0} | 👩‍🦱 Nữ: ${info.female ?? 0}

${grouped}

💰 *Tổng cộng:* ${total}₫`);
      }

      // xem phong chua khao sat am thanh
      else if (text === "/ksat") {
        const opened = rooms.filter(r => r.start && r.opened);
        const today = todayKey();
        const surveyed = new Set((ksLog[today] || []).map(e => e.room));
        const un = opened.filter(r => !surveyed.has(r.room_code));
        if (!un.length) { await tgSend(chatId, `✅ Tất cả phòng tại *${branch}* đã khảo sát.`); continue; }
        const msg = un.map(r=>{
          const duration = formatDuration(diffMinutes(r.start));
          return `🎤 *${r.room_code}* (${r.type}) – ${duration}`;
        }).join("\n");
        await tgSend(chatId, `📋 *Phòng chưa khảo sát tại ${branch} (${un.length})*\n\n${msg}`);
      }

      // danh dau khao sat am thanh xong
      else if (text.startsWith("/ksxong")) {
        const code = text.replace("/ksxong","").trim();
        if (!code) { await tgSend(chatId,"💡 `/ksxong <phòng>`"); continue; }
        const today=todayKey();
        if (!ksLog[today]) ksLog[today]=[];
        if (!ksLog[today].some(x=>x.room===code))
          ksLog[today].push({room:code,time:new Date().toLocaleTimeString("vi-VN")});
        fs.writeFileSync(ksFile,JSON.stringify(ksLog,null,2));
        await tgSend(chatId,`✅ *Phòng ${code}* tại *${branch}* đã khảo sát xong.`);
      }

      // thong ke ksat trong ngay ( cái này còn lỏ lắm kaka )
      else if (text==="/tkeksat") {
        const today=todayKey(); const list=ksLog[today]||[];
        if(!list.length){await tgSend(chatId,`📭 *${branch}* chưa có KS hôm nay.`);continue;}
        const msg=list.map(x=>`🎧 *${x.room}* – ${x.time}`).join("\n");
        await tgSend(chatId,`📊 *KS hôm nay tại ${branch} (${today})*\n\n${msg}`);
      }
      else if (text==="/tke") {
        const month=monthKey(); const keys=Object.keys(ksLog);
        if(!keys.length){await tgSend(chatId,`📭 *${branch}* chưa có dữ liệu KS.`);continue;}
        let msg="",total=0;
        for(const d of keys){const arr=ksLog[d];if(d.startsWith(month))total+=arr.length;msg+=`📆 *${d}*: ${arr.length}\n`;}
        msg+=`\n🗓 *Tổng tháng ${month.split("-")[1]}:* ${total} lượt KSAT.`;
        await tgSend(chatId,`📅 *Thống kê KSAT tại ${branch}*\n\n${msg}`);
      }

      // MUTE :>
      else if (text.startsWith("/mute")) {
        const [_, s, e] = text.split(" ");
        if (s && e) {
          muteStart = +s; muteEnd = +e; muteEnabled = true;
          await tgSend(chatId, `🔕 Tắt thông báo từ ${s}h → ${e}h`);
        } else await tgSend(chatId, "💡 `/mute <giờ bắt đầu> <giờ kết thúc>`");
      }
    }
  } catch (e) { console.error("pollTelegram:", e.message); }
}

// CRON SYSTEM
let lastRooms = {};

async function checkNewRooms() {
  if (isMutedNow()) return;
  for (const [u, info] of Object.entries(users)) {
    const store=info.store, chatId=info.chatId;
    const rooms=await fetchRooms(store);
    const opened=rooms.filter(r=>r.start&&r.opened);
    const branch=rooms[0]?.store_name || `Chi nhánh ${store}`;
    if(!lastRooms[store]){lastRooms[store]={};opened.forEach(r=>lastRooms[store][r.room_code]=true);continue;}
    const newR=opened.filter(r=>!lastRooms[store][r.room_code]);
    lastRooms[store]={};opened.forEach(r=>lastRooms[store][r.room_code]=true);
    if(newR.length){
      const msg=newR.map(r=>`🎉 *Phòng ${r.room_code}* (${r.type})\n🕒 ${r.start}\n💰 ${r.revenue_tmp.toLocaleString()}₫`).join("\n\n");
      await tgSend(chatId,`🚪 *Phòng mới mở tại ${branch}:*\n\n${msg}\n\n♻️ Reload sau ${intervalMinutes} phút`);
    }
  }
}

// cron nhac nho khao sat
async function checkKSReminders() {
  if (isMutedNow()) return;
  for (const [u, info] of Object.entries(users)) {
    const store=info.store, chatId=info.chatId;
    const ksFile=getUserKsFile(u);
    const ksLog=JSON.parse(fs.readFileSync(ksFile,"utf8"));
    const today=todayKey();
    const surveyed=new Set((ksLog[today]||[]).map(e=>e.room));
    const rooms=await fetchRooms(store);
    const branch=rooms[0]?.store_name || `Chi nhánh ${store}`;
    for(const r of rooms.filter(x=>x.start&&x.opened)){
      const m=diffMinutes(r.start);
      if(m>=30&&m<40&&!surveyed.has(r.room_code)){
        const durationText = formatDuration(m);
        await tgSend(chatId,
`🎤 *Phòng ${r.room_code}* (${r.type}) đã chơi *${durationText}*.
💡 Hãy vào phòng khảo sát và chăm sóc khách nhé bạn!`,
[[{text:"✅ Đã khảo sát xong",callback_data:`ksxong_${r.room_code}`}]]
        );
      }
    }
  }
}

async function dailySummary(){
  const now=new Date();
  if(now.getHours()!==20||now.getMinutes()>5)return;
  for(const [u,info] of Object.entries(users)){
    const ksFile=getUserKsFile(u);const ksLog=JSON.parse(fs.readFileSync(ksFile,"utf8"));
    const today=todayKey();const list=ksLog[today]||[];
    const msg=list.length?list.map(x=>`🎧 *${x.room}* – ${x.time}`).join("\n"):"📭 Chưa có KS hôm nay.";
    await tgSend(info.chatId,`📅 *Tổng kết KSAT hôm nay (${today})*\n\n${msg}`);
  }
}

// INIT
registerBotCommands();
setInterval(pollTelegram, 3000);
setInterval(checkKSReminders, intervalMinutes * 60000);
setInterval(checkNewRooms, intervalMinutes * 60000);
setInterval(dailySummary, 60000);
console.log("Server runing on my PC.......");
