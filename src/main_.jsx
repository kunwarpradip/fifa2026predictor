import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";
import { scorePrediction } from "./scoring";
import "./styles.css";

const TIME_ZONE = "America/Chicago";
const TIME_ZONE_LABEL = "CT";
const LOCK_MINUTES_BEFORE_KICKOFF = 0;

function formatCentralDate(iso) {
  if (!iso) return "Date not set";

  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatCentralDateTime(iso) {
  if (!iso) return "Date not set";

  return new Date(iso).toLocaleString("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCentralLockTime(iso) {
  if (!iso) return "Lock time not set";

  const lockTime =
    new Date(iso).getTime() - LOCK_MINUTES_BEFORE_KICKOFF * 60 * 1000;

  return new Date(lockTime).toLocaleString("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toLocalInputValue(iso) {
  if (!iso) return "";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "";

  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function formatCountdown(ms) {
  if (ms <= 0) return "Prediction Closed";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;

  return `${minutes}m ${seconds}s`;
}

function App() {
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [matches, setMatches] = useState([]);
  const [myPredictions, setMyPredictions] = useState([]);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState("matches");

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);

      if (!user) {
        setProfile(null);
        setIsAdmin(false);
        return;
      }

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          name: user.displayName || "",
          country: "",
          photoURL: user.photoURL || "",
          email: user.email || "",
          createdAt: serverTimestamp(),
        });
      }

      const adminSnap = await getDoc(doc(db, "admins", user.uid));
      setIsAdmin(adminSnap.exists());
    });
  }, []);

  useEffect(() => {
    if (!authUser) return;

    const unsubProfile = onSnapshot(doc(db, "users", authUser.uid), (snap) => {
      setProfile({ id: snap.id, ...snap.data() });
    });

    const unsubMatches = onSnapshot(
      query(collection(db, "matches"), orderBy("kickoff", "asc")),
      (snap) => {
        setMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
    );

    const unsubPredictions = onSnapshot(
      query(collection(db, "predictions"), where("uid", "==", authUser.uid)),
      (snap) => {
        setMyPredictions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
    );

    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubProfile();
      unsubMatches();
      unsubPredictions();
      unsubUsers();
    };
  }, [authUser]);

  const leaderboard = useMemo(() => {
    return users
      .map((user) => {
        const userPredictions = predictions.filter((p) => p.uid === user.id);

        const points = userPredictions.reduce((sum, prediction) => {
          const match = matches.find((m) => m.id === prediction.matchId);
          return sum + scorePrediction(prediction, match);
        }, 0);

        const exact = userPredictions.filter((prediction) => {
          const match = matches.find((m) => m.id === prediction.matchId);
          return scorePrediction(prediction, match) === 4;
        }).length;

        return { ...user, points, exact };
      })
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.exact - a.exact ||
          (a.name || "").localeCompare(b.name || ""),
      );
  }, [users, predictions, matches]);

  if (!authUser) return <Login />;

  return (
    <main className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">World Cup 2026</p>
          <h1>Predict & climb</h1>

          <p className="timezone">
            🕒 All match times are displayed in Central Time ({TIME_ZONE_LABEL}
            ). Predictions lock at kickoff.
          </p>
        </div>

        <div className="logoutWrapper">
          <button
            className="iconBtn"
            onClick={() => signOut(auth)}
            title="Sign out"
          >
            ↗
          </button>

          <span className="logoutLabel">Logout</span>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={tab === "matches" ? "active" : ""}
          onClick={() => setTab("matches")}
        >
          🏆 Matches
        </button>

        <button
          className={tab === "leaderboard" ? "active" : ""}
          onClick={() => setTab("leaderboard")}
        >
          🥇 Board
        </button>

        <button
          className={tab === "profile" ? "active" : ""}
          onClick={() => setTab("profile")}
        >
          👤 Profile
        </button>

        {isAdmin && (
          <button
            className={tab === "admin" ? "active" : ""}
            onClick={() => setTab("admin")}
          >
            🛡 Admin
          </button>
        )}
      </nav>

      {tab === "matches" && (
        <Matches
          matches={matches}
          predictions={myPredictions}
          uid={authUser.uid}
        />
      )}

      {tab === "leaderboard" && <Leaderboard rows={leaderboard} />}

      {tab === "profile" && <Profile profile={profile} uid={authUser.uid} />}

      {tab === "admin" && isAdmin && <Admin matches={matches} />}
    </main>
  );
}

function Login() {
  return (
    <main className="login">
      <section className="loginCard">
        <div className="ball">⚽</div>

        <p className="eyebrow">FIFA World Cup 2026</p>

        <h1>Score predictions with friends</h1>

        <p className="muted">
          Sign in once with Gmail. Your browser keeps you logged in for a
          long-lasting, low-friction experience.
        </p>

        <button
          className="primary"
          onClick={() => signInWithPopup(auth, googleProvider)}
        >
          Continue with Google
        </button>
      </section>
    </main>
  );
}

function Matches({ matches, predictions, uid }) {
  const grouped = matches.reduce((acc, match) => {
    const day = formatCentralDate(match.kickoff);
    (acc[day] ||= []).push(match);
    return acc;
  }, {});

  const jumpToCurrentMatchDay = () => {
    const now = Date.now();

    const upcomingMatch =
      matches.find((match) => new Date(match.kickoff).getTime() >= now) ||
      matches[matches.length - 1];

    if (!upcomingMatch) return;

    const dayId = `day-${formatCentralDate(upcomingMatch.kickoff)
      .replaceAll(" ", "-")
      .replaceAll(",", "")}`;

    document.getElementById(dayId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <section>
      {matches.length > 0 && (
        <button className="jumpButton" onClick={jumpToCurrentMatchDay}>
          📍 Jump to next match
        </button>
      )}

      {Object.entries(grouped).map(([day, list]) => {
        const dayId = `day-${day.replaceAll(" ", "-").replaceAll(",", "")}`;

        return (
          <div key={day} id={dayId}>
            <h2 className="day">📅 {day}</h2>

            {list.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                prediction={predictions.find(
                  (p) => p.uid === uid && p.matchId === match.id,
                )}
                uid={uid}
              />
            ))}
          </div>
        );
      })}

      {matches.length === 0 && (
        <Empty text="No matches yet. Ask an admin to add fixtures." />
      )}
    </section>
  );
}

function MatchCard({ match, prediction, uid }) {
  const lockTime =
    new Date(match.kickoff).getTime() - LOCK_MINUTES_BEFORE_KICKOFF * 60 * 1000;

  const locked = Date.now() >= lockTime;

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const countdownText = formatCountdown(lockTime - now);

  const [homeGoals, setHomeGoals] = useState(prediction?.homeGoals ?? "");
  const [awayGoals, setAwayGoals] = useState(prediction?.awayGoals ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setHomeGoals(prediction?.homeGoals ?? "");
    setAwayGoals(prediction?.awayGoals ?? "");
  }, [prediction?.homeGoals, prediction?.awayGoals]);

  async function save() {
    if (locked) {
      return alert("Predictions are locked for this match.");
    }

    await setDoc(
      doc(db, "predictions", `${uid}_${match.id}`),
      {
        uid,
        matchId: match.id,
        homeGoals: Number(homeGoals),
        awayGoals: Number(awayGoals),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <article className="card match">
      <div className="matchTop">
        <span>
          {formatCentralDateTime(match.kickoff)} {TIME_ZONE_LABEL}
        </span>

        <span className={locked ? "pill locked" : "pill"}>
          {locked ? "Locked" : "Open"}
        </span>
      </div>

      <div className="teams">
        <strong>{match.homeTeam}</strong>

        <input
          type="number"
          min="0"
          value={homeGoals}
          disabled={locked}
          onChange={(e) => setHomeGoals(e.target.value)}
        />

        <span>vs</span>

        <input
          type="number"
          min="0"
          value={awayGoals}
          disabled={locked}
          onChange={(e) => setAwayGoals(e.target.value)}
        />

        <strong>{match.awayTeam}</strong>
      </div>

      <div className={locked ? "countdownBanner closed" : "countdownBanner"}>
        <span className="countdownLabel">
          {locked ? "Prediction Closed" : "Prediction closes in"}
        </span>

        {!locked && <span className="countdownValue">{countdownText}</span>}
      </div>

      {match.resultPublished && (
        <p className="result">
          Result: {match.homeGoals} - {match.awayGoals} · You earned{" "}
          {prediction ? scorePrediction(prediction, match) : 0} pts
        </p>
      )}

      {saved && <p className="success">✅ Prediction saved</p>}

      <div className="predictionAction">
        <button
          className="secondary predictionButton"
          onClick={save}
          disabled={locked || homeGoals === "" || awayGoals === ""}
        >
          {prediction ? "Update My Prediction" : "Save My Prediction"}
        </button>
      </div>
    </article>
  );
}

function Leaderboard({ rows }) {
  return (
    <section className="card">
      <h2>Leaderboard</h2>

      {rows.map((row, index) => (
        <div className="rank" key={row.id}>
          <img
            src={row.photoURL || "https://placehold.co/80x80?text=User"}
            alt={row.name || "Player"}
          />

          <div>
            <strong>
              #{index + 1} {row.name || "Player"}
            </strong>
            <p>
              {row.country || "No country"} · {row.exact} exact scores
            </p>
          </div>

          <b>{row.points} pts</b>
        </div>
      ))}

      {rows.length === 0 && <Empty text="No players yet." />}
    </section>
  );
}

function Profile({ profile, uid }) {
  const [form, setForm] = useState({
    name: "",
    country: "",
    photoURL: "",
  });

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;

    setForm({
      name: profile.name || "",
      country: profile.country || "",
      photoURL: profile.photoURL || "",
    });
  }, [profile]);

  async function save() {
    await setDoc(doc(db, "users", uid), form, { merge: true });

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <section className="card">
      <h2>Your profile</h2>

      <label>
        Name
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>

      <label>
        Country
        <input
          value={form.country}
          onChange={(e) => setForm({ ...form, country: e.target.value })}
        />
      </label>

      <label>
        Photo URL
        <input
          value={form.photoURL}
          onChange={(e) => setForm({ ...form, photoURL: e.target.value })}
        />
      </label>

      {saved && <p className="success">✅ Profile saved</p>}

      <button className="primary" onClick={save}>
        Save profile
      </button>
    </section>
  );
}

function Admin({ matches }) {
  const [match, setMatch] = useState({
    id: "",
    homeTeam: "",
    awayTeam: "",
    kickoff: "",
    round: "",
  });

  const [saved, setSaved] = useState("");

  async function createMatch() {
    if (!match.id || !match.homeTeam || !match.awayTeam || !match.kickoff) {
      return alert("Please fill match ID, teams, and kickoff.");
    }

    await setDoc(doc(db, "matches", match.id), {
      homeTeam: match.homeTeam.trim(),
      awayTeam: match.awayTeam.trim(),
      round: match.round.trim(),
      kickoff: new Date(match.kickoff).toISOString(),
      resultPublished: false,
      createdAt: serverTimestamp(),
    });

    setSaved(`✅ ${match.homeTeam} vs ${match.awayTeam} added`);
    setMatch({
      id: "",
      homeTeam: "",
      awayTeam: "",
      kickoff: "",
      round: "",
    });

    setTimeout(() => setSaved(""), 2500);
  }

  return (
    <section>
      <article className="card">
        <h2>Create match</h2>

        <label>
          Match ID
          <input
            placeholder="match003"
            value={match.id}
            onChange={(e) => setMatch({ ...match, id: e.target.value })}
          />
        </label>

        <label>
          Round
          <input
            placeholder="Group A"
            value={match.round}
            onChange={(e) => setMatch({ ...match, round: e.target.value })}
          />
        </label>

        <label>
          Home team
          <input
            value={match.homeTeam}
            onChange={(e) => setMatch({ ...match, homeTeam: e.target.value })}
          />
        </label>

        <label>
          Away team
          <input
            value={match.awayTeam}
            onChange={(e) => setMatch({ ...match, awayTeam: e.target.value })}
          />
        </label>

        <label>
          Kickoff
          <input
            type="datetime-local"
            value={match.kickoff}
            onChange={(e) => setMatch({ ...match, kickoff: e.target.value })}
          />
        </label>

        {saved && <p className="success">{saved}</p>}

        <button className="primary" onClick={createMatch}>
          ＋ Add match
        </button>
      </article>

      <h2 className="day">Publish results</h2>

      {matches.map((match) => (
        <AdminResult key={match.id} match={match} />
      ))}
    </section>
  );
}

function AdminResult({ match }) {
  const [editing, setEditing] = useState(false);
  const [homeTeam, setHomeTeam] = useState(match.homeTeam ?? "");
  const [awayTeam, setAwayTeam] = useState(match.awayTeam ?? "");
  const [round, setRound] = useState(match.round ?? "");
  const [kickoff, setKickoff] = useState(toLocalInputValue(match.kickoff));
  const [homeGoals, setHomeGoals] = useState(match.homeGoals ?? "");
  const [awayGoals, setAwayGoals] = useState(match.awayGoals ?? "");
  const [saved, setSaved] = useState("");

  const lockTime =
    new Date(match.kickoff).getTime() - LOCK_MINUTES_BEFORE_KICKOFF * 60 * 1000;
  const isLocked = Date.now() >= lockTime;

  useEffect(() => {
    setHomeTeam(match.homeTeam ?? "");
    setAwayTeam(match.awayTeam ?? "");
    setRound(match.round ?? "");
    setKickoff(toLocalInputValue(match.kickoff));
    setHomeGoals(match.homeGoals ?? "");
    setAwayGoals(match.awayGoals ?? "");
  }, [match]);

  async function saveMatchDetails() {
    if (!homeTeam || !awayTeam || !kickoff) {
      return alert("Please fill home team, away team, and kickoff.");
    }

    await updateDoc(doc(db, "matches", match.id), {
      homeTeam: homeTeam.trim(),
      awayTeam: awayTeam.trim(),
      round: round.trim(),
      kickoff: new Date(kickoff).toISOString(),
      updatedAt: serverTimestamp(),
    });

    setEditing(false);
    setSaved("✅ Match updated");
    setTimeout(() => setSaved(""), 2500);
  }
  async function recalculateLeaderboard() {
    const predictionsSnap = await getDocs(collection(db, "predictions"));
    const usersSnap = await getDocs(collection(db, "users"));
    const matchesSnap = await getDocs(collection(db, "matches"));

    const allMatches = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const allPredictions = predictionsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    const batch = writeBatch(db);

    allUsers.forEach((user) => {
      const userPredictions = allPredictions.filter((p) => p.uid === user.id);

      const totalPoints = userPredictions.reduce((sum, prediction) => {
        const predictionMatch = allMatches.find(
          (m) => m.id === prediction.matchId,
        );
        return sum + scorePrediction(prediction, predictionMatch);
      }, 0);

      const exactScores = userPredictions.filter((prediction) => {
        const predictionMatch = allMatches.find(
          (m) => m.id === prediction.matchId,
        );
        return scorePrediction(prediction, predictionMatch) === 4;
      }).length;

      batch.set(
        doc(db, "users", user.id),
        {
          totalPoints,
          exactScores,
          leaderboardUpdatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });

    await batch.commit();
  }

  async function publish() {
    if (homeGoals === "" || awayGoals === "") {
      return alert("Please enter both final scores.");
    }

    await updateDoc(doc(db, "matches", match.id), {
      homeGoals: Number(homeGoals),
      awayGoals: Number(awayGoals),
      resultPublished: true,
      updatedAt: serverTimestamp(),
    });

    setSaved("✅ Result published");
    setTimeout(() => setSaved(""), 2500);
  }

  async function unpublish() {
    await updateDoc(doc(db, "matches", match.id), {
      resultPublished: false,
      updatedAt: serverTimestamp(),
    });

    setSaved("↩️ Result unpublished");
    setTimeout(() => setSaved(""), 2500);
  }

  async function removeMatch() {
    if (!confirm(`Delete ${match.homeTeam} vs ${match.awayTeam}?`)) return;

    await deleteDoc(doc(db, "matches", match.id));
  }

  async function sendEmailNotification() {
    const usersSnap = await getDocs(collection(db, "users"));
    const predictionsSnap = await getDocs(
      query(collection(db, "predictions"), where("matchId", "==", match.id)),
    );

    const allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const matchPredictions = predictionsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    const bccEmails = allUsers.map((u) => u.email).filter(Boolean);

    if (bccEmails.length === 0) {
      return alert("No users to notify.");
    }

    const predictions = matchPredictions
      .map((p) => {
        const user = allUsers.find((u) => u.id === p.uid);
        return {
          playerName: user?.name || "Anonymous",
          homeGoals: p.homeGoals ?? "-",
          awayGoals: p.awayGoals ?? "-",
        };
      })
      .sort((a, b) => a.playerName.localeCompare(b.playerName));

    const matchData = {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoff: formatCentralDateTime(match.kickoff),
    };

    try {
      const html = generateEmailHtml(matchData, predictions);

      await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: [{ email: import.meta.env.VITE_SENDGRID_TO_EMAIL }],
              bcc: bccEmails.map((email) => ({ email })),
              subject: `🏆 ${match.homeTeam} vs ${match.awayTeam} - Match Kickoff`,
            },
          ],
          from: {
            email: import.meta.env.VITE_SENDGRID_FROM_EMAIL,
            name: "FIFA World Cup 2026",
          },
          content: [
            {
              type: "text/html",
              value: html,
            },
          ],
        }),
      });

      setSaved(`✅ Email sent`);
      setTimeout(() => setSaved(""), 2500);
    } catch (error) {
      alert(`Error sending emails: ${error.message}`);
    }
  }

  function generateEmailHtml(matchData, predictions) {
    const predictionRows = predictions
      .map(
        (p) => `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #ddd;">${p.playerName}</td>
          <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center;">${p.homeGoals}</td>
          <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center;">${p.awayGoals}</td>
        </tr>
      `,
      )
      .join("");

    return `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2>${matchData.homeTeam} vs ${matchData.awayTeam}</h2>
            <p><strong>Kickoff:</strong> ${matchData.kickoff}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
              <thead>
                <tr style="background: #f5f5f5;">
                  <th style="padding: 10px; text-align: left; border-bottom: 2px solid #333;">Name</th>
                  <th style="padding: 10px; text-align: center; border-bottom: 2px solid #333;">${matchData.homeTeam}</th>
                  <th style="padding: 10px; text-align: center; border-bottom: 2px solid #333;">${matchData.awayTeam}</th>
                </tr>
              </thead>
              <tbody>
                ${predictionRows}
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `;
  }

  return (
    <article className="card compact">
      {!editing ? (
        <>
          <strong>
            {match.id}: {match.homeTeam} vs {match.awayTeam}
          </strong>

          <p className="muted">
            {match.round || "No round"} · {formatCentralDateTime(match.kickoff)}{" "}
            {TIME_ZONE_LABEL}
          </p>

          <button className="secondary" onClick={() => setEditing(true)}>
            Edit match
          </button>
        </>
      ) : (
        <>
          <label>
            Home team
            <input
              value={homeTeam}
              onChange={(e) => setHomeTeam(e.target.value)}
            />
          </label>

          <label>
            Away team
            <input
              value={awayTeam}
              onChange={(e) => setAwayTeam(e.target.value)}
            />
          </label>

          <label>
            Round
            <input value={round} onChange={(e) => setRound(e.target.value)} />
          </label>

          <label>
            Kickoff
            <input
              type="datetime-local"
              value={kickoff}
              onChange={(e) => setKickoff(e.target.value)}
            />
          </label>

          <div className="scoreRow">
            <button className="primary" onClick={saveMatchDetails}>
              Save
            </button>

            <button className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      )}

      <div className="scoreRow">
        <input
          type="number"
          min="0"
          value={homeGoals}
          onChange={(e) => setHomeGoals(e.target.value)}
        />

        <input
          type="number"
          min="0"
          value={awayGoals}
          onChange={(e) => setAwayGoals(e.target.value)}
        />

        <button className="secondary" onClick={publish}>
          {match.resultPublished ? "Update result" : "Publish"}
        </button>
      </div>

      <div className="scoreRow">
        <button className="secondary" onClick={unpublish}>
          Unpublish
        </button>

        <button className="danger" onClick={removeMatch}>
          Delete
        </button>
      </div>

      <div className="scoreRow">
        <button className="secondary" onClick={sendEmailNotification}>
          📧 Send Match Email
        </button>
      </div>

      {saved && <p className="success">{saved}</p>}
    </article>
  );
}

function Empty({ text }) {
  return <p className="muted empty">{text}</p>;
}

createRoot(document.getElementById("root")).render(<App />);
