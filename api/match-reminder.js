const admin = require('firebase-admin');

if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.database();

const defaultTemplate = [
        { dinsdag: ["Marcel", "Mark", "Ronald", "Sander"], donderdag: ["Dennis", "Robert", "Marcel", "Mark"] },
        { dinsdag: ["Ronald", "Dennis", "Robert", "Sander"], donderdag: ["Marcel", "Mark", "Ronald", "Sander"] },
        { dinsdag: ["Marcel", "Dennis", "Mark", "Robert"], donderdag: ["Ronald", "Sander", "Dennis", "Marcel"] },
        { dinsdag: ["Ronald", "Mark", "Marcel", "Sander"], donderdag: ["Dennis", "Ronald", "Robert", "Mark"] },
        { dinsdag: ["Marcel", "Sander", "Dennis", "Robert"], donderdag: ["Ronald", "Mark", "Marcel", "Sander"] },
        { dinsdag: ["Ronald", "Dennis", "Robert", "Mark"], donderdag: ["Marcel", "Sander", "Ronald", "Robert"] }
];

function getMonday(d) {
    d = new Date(d);
    let day = d.getDay();
    let diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function getISOWeekNumber(d) {
    let date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    let week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

module.exports = async (req, res) => {
    try {
        const now = new Date();

        const optionsDay = { timeZone: 'Europe/Amsterdam', weekday: 'short' };
        const optionsHour = { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false };

        const currentDay = new Intl.DateTimeFormat('en-US', optionsDay).format(now); 
        const currentHour = parseInt(new Intl.DateTimeFormat('en-US', optionsHour).format(now), 10);

        if ((currentDay !== 'Tue' && currentDay !== 'Thu') || currentHour !== 17) {
            return res.status(200).json({ 
                status: `Geen actie match-reminder: Vandaag is ${currentDay} en het is ${currentHour}:00 uur (vereist: di/do om 17:00).` 
            });
        }

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const dayNum = String(now.getDate()).padStart(2, '0');
        const dateKey = `${year}-${month}-${dayNum}`;
        const dayKey = currentDay === 'Tue' ? 'dinsdag' : 'donderdag';

        const reminderRef = db.ref(`padelData/sentMatchReminders/${dateKey}`);
        const snapshot = await reminderRef.once('value');
        if (snapshot.exists()) {
            return res.status(200).json({ status: `Wedstrijdherinnering voor ${dateKey} is al verzonden.` });
        }

        const currentMonday = getMonday(now);
        currentMonday.setHours(0, 0, 0, 0);

        const currentWeekNum = getISOWeekNumber(currentMonday);
        const currentYear = currentMonday.getFullYear();
        const uniqueWeekKey = `${currentYear}_w${currentWeekNum}`;

        const referenceMonday = new Date(2026, 8, 21);
        const diffTime = currentMonday.getTime() - referenceMonday.getTime();
        const diffWeeks = Math.round(diffTime / (1000 * 60 * 60 * 24 * 7));
        const templateIndex = ((diffWeeks % 6) + 6) % 6;

        const [overridesSnap, absenceSnap, tokensSnap] = await Promise.all([
            db.ref(`padelData/scheduleOverrides/${uniqueWeekKey}`).once('value'),
            db.ref('padelData/absence').once('value'),
            db.ref('padelData/tokens').once('value')
        ]);

        const overrides = overridesSnap.val() || {};
        const absences = absenceSnap.val() || {};
        const tokensData = tokensSnap.val() || {};

        const tpl = defaultTemplate[templateIndex];
        const matchPlayers = overrides[dayKey] !== undefined ? overrides[dayKey] : tpl[dayKey];

        const activePlayersToNotify = matchPlayers.filter(player => {
            const playerAbsences = absences[player] || {};
            const isAbsent = playerAbsences[`${uniqueWeekKey}_${dayKey}`];
            return !isAbsent;
        });

        let targetTokens = [];
        activePlayersToNotify.forEach(player => {
            if (tokensData[player]) {
                const playerTokens = Object.keys(tokensData[player]);
                targetTokens.push(...playerTokens);
            }
        });

        if (targetTokens.length === 0) {
            return res.status(200).json({ status: "Geen actieve tokens gevonden om te notifiëren." });
        }

        const messagePayload = {
            notification: {
                title: "🎾 Padel Reminder",
                body: "Vanavond is het weer zover! Vergeet niet dat je vanavond de baan op moet."
            },
            tokens: targetTokens
        };

        const response = await admin.messaging().sendEachForMulticast(messagePayload);

        await reminderRef.set(true);

        return res.status(200).json({
            success: true,
            notifiedPlayers: activePlayersToNotify,
            successCount: response.successCount
        });

    } catch (error)  {
        console.error("Fout bij versturen match reminder:", error);
        return res.status(500).json({ error: error.message });
    }
};
