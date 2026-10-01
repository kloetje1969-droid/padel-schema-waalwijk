import { initializeApp, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';

// Firebase Admin initialisatie
if (!getApps().length) {
  initializeApp({
    databaseURL: "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app"
  });
}

const db = getDatabase();
const messaging = getMessaging();

// Het vaste 6-wekenschema
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

export default async function handler(req, res) {
    try {
        const now = new Date();

        // 1. Controleer of het vandaag dinsdag ('Tue') of donderdag ('Thu') is in Nederland
        const optionsDay = { timeZone: 'Europe/Amsterdam', weekday: 'short' };
        const currentDayName = new Intl.DateTimeFormat('en-US', optionsDay).format(now);
        
        if (currentDayName !== 'Tue' && currentDayName !== 'Thu') {
            return res.status(200).json({ 
                status: `Geen actie match-reminder: Vandaag (${currentDayName}) is geen speeldag.` 
            });
        }

        // 2. Controleer of het exact 17:00 uur is in Nederland (houdt rekening met zomer/wintertijd)
        const optionsHour = { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false };
        const currentHour = parseInt(new Intl.DateTimeFormat('en-US', optionsHour).format(now), 10);

        if (currentHour !== 17) {
            return res.status(200).json({ 
                status: `Geen actie match-reminder: Het is nu ${currentHour}:00 uur (vereist: 17:00).` 
            });
        }

        const dayName = currentDayName === 'Tue' ? 'dinsdag' : 'donderdag';
        
        // Bepaal de huidige week en template index
        let currentMonday = getMonday(now);
        let currentWeekNum = getISOWeekNumber(currentMonday);
        let currentYear = currentMonday.getFullYear();
        let uniqueWeekKey = `${currentYear}_w${currentWeekNum}`;

        let referenceMonday = new Date(2026, 8, 21); // 21 september 2026
        let diffTime = currentMonday.getTime() - referenceMonday.getTime();
        let diffWeeks = Math.round(diffTime / (1000 * 60 * 60 * 24 * 7));
        let templateIndex = ((diffWeeks % 6) + 6) % 6;

        // Haal eventuele live overrides op uit Firebase
        const snapshot = await db.ref(`padelData/scheduleOverrides/${uniqueWeekKey}`).once('value');
        const overrideData = snapshot.val() || {};

        let tpl = defaultTemplate[templateIndex];
        let scheduledPlayers = overrideData[dayName] !== undefined ? overrideData[dayName] : tpl[dayName];

        // Filter eventuele spelers die zich hebben afgemeld voor deze avond
        const absenceSnapshot = await db.ref('padelData/absence').once('value');
        const absences = absenceSnapshot.val() || {};

        let activePlayers = scheduledPlayers.filter(p => {
            const isAbsent = absences[p] && absences[p][`${uniqueWeekKey}_${dayName}`];
            return !isAbsent;
        });

        if (activePlayers.length === 0) {
            return res.status(200).json({ message: "Alle spelers zijn afgemeld voor vanavond. Geen herinnering verzonden." });
        }

        // Haal alle opgeslagen FCM tokens op uit Firebase
        const tokensSnapshot = await db.ref('padelData/tokens').once('value');
        const allTokensData = tokensSnapshot.val() || {};

        let targetTokens = [];
        activePlayers.forEach(player => {
            if (allTokensData[player]) {
                const playerTokens = Object.keys(allTokensData[player]);
                targetTokens.push(...playerTokens);
            }
        });

        if (targetTokens.length === 0) {
            return res.status(200).json({ message: "Geen actieve push-tokens gevonden voor de spelers van vanavond." });
        }

        // Verstuur de pushmelding uitsluitend naar deze tokens
        const messagePayload = {
            notification: {
                title: `🎾 Padel Herinnering (${dayName.charAt(0).toUpperCase() + dayName.slice(1)})`,
                body: `Hey! Jij staat vanavond (${activePlayers.join(', ')}) ingepland om te padellen om 18:00 uur!`
            },
            tokens: targetTokens
        };

        const response = await messaging.sendEachForMulticast(messagePayload);
        
        return res.status(200).json({
            success: true,
            sentTo: activePlayers,
            successCount: response.successCount,
            failureCount: response.failureCount
        });

    } catch (error) {
        console.error("Fout bij versturen match reminder:", error);
        return res.status(500).json({ error: error.message });
    }
}
