import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { flagUrl } from "./teamFlags";
import emailjs from "@emailjs/browser";

const TIME_ZONE = "America/Chicago";
const TIME_ZONE_LABEL = "CT";
const LOCK_MINUTES_BEFORE_KICKOFF = 0;
const PAYMENT_STATUS_PAID = "paid";
const PAYMENT_STATUS_UNPAID = "unpaid";

function hasPendingEntryFee(user) {
  return user?.approved === true && user?.paymentStatus !== PAYMENT_STATUS_PAID;
}

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
  const [worldCupSettings, setWorldCupSettings] = useState(null);
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
        setMyPredictions([]);
        return;
      }

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          name: user.displayName || "",
          place: "",
          photoURL: user.photoURL || "",
          email: user.email || "",
          totalPoints: 0,
          exactScores: 0,
          paymentStatus: PAYMENT_STATUS_UNPAID,
          entryFeePaid: false,
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

    const unsubSettings = onSnapshot(
      doc(db, "settings", "worldCup"),
      (snap) => {
        setWorldCupSettings(snap.exists() ? snap.data() : null);
      },
    );

    // Important optimization: users only load their own predictions.
    const unsubPredictions = onSnapshot(
      query(collection(db, "predictions"), where("uid", "==", authUser.uid)),
      (snap) => {
        setMyPredictions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
    );

    // Leaderboard is now based on stored totals in users/{uid}, not all predictions.
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubProfile();
      unsubMatches();
      unsubPredictions();
      unsubUsers();
      unsubSettings();
    };
  }, [authUser]);

  const leaderboard = useMemo(() => {
    return users
      .filter((user) => user.approved)
      .map((user) => ({
        ...user,
        points: Number(user.totalPoints || 0),
        exact: Number(user.exactScores || 0),
      }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.exact - a.exact ||
          (a.name || "").localeCompare(b.name || ""),
      );
  }, [users]);

  if (!authUser) return <Login />;

  if (!profile) {
    return (
      <main className="app">
        <section className="card">
          <h2>Loading...</h2>
        </section>
      </main>
    );
  }

  if (!profile.approved && !isAdmin) {
    return <PendingApproval />;
  }

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
          className={tab === "predictions" ? "active" : ""}
          onClick={() => setTab("predictions")}
        >
          👀 Picks
        </button>

        <button
          className={tab === "leaderboard" ? "active" : ""}
          onClick={() => setTab("leaderboard")}
        >
          🥇 Board
        </button>

        <button
          className={tab === "rules" ? "active" : ""}
          onClick={() => setTab("rules")}
        >
          📜 Rules
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

      {hasPendingEntryFee(profile) && <PaymentPendingBanner />}

      {tab === "matches" && (
        <Matches
          matches={matches}
          predictions={myPredictions}
          uid={authUser.uid}
          profile={profile}
        />
      )}

      {tab === "predictions" && (
        <PublicPredictions matches={matches} users={users} />
      )}
      {tab === "leaderboard" && <Leaderboard rows={leaderboard} />}

      {tab === "rules" && <Rules />}

      {tab === "profile" && <Profile profile={profile} uid={authUser.uid} />}

      {tab === "admin" && isAdmin && (
        <Admin
          matches={matches}
          users={users}
          worldCupSettings={worldCupSettings}
        />
      )}
    </main>
  );
}

function PaymentPendingBanner() {
  const bannerRef = useRef(null);
  const [isDocked, setIsDocked] = useState(false);

  useEffect(() => {
    function updateDockedState() {
      const banner = bannerRef.current;
      if (!banner) return;

      setIsDocked(banner.getBoundingClientRect().bottom < 0);
    }

    updateDockedState();
    window.addEventListener("scroll", updateDockedState, { passive: true });
    window.addEventListener("resize", updateDockedState);

    return () => {
      window.removeEventListener("scroll", updateDockedState);
      window.removeEventListener("resize", updateDockedState);
    };
  }, []);

  return (
    <>
      <div className="paymentBanner" role="status" ref={bannerRef}>
        <span className="paymentMarker" />
        <div>
          <strong>Entry fee payment pending</strong>
          <span>Your entry fee payment is still pending.</span>
        </div>
      </div>

      {isDocked && (
        <div className="paymentDock" role="status">
          <span className="paymentDockDot" />
          <strong>Entry fee pending</strong>
        </div>
      )}
    </>
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

function PendingApproval() {
  return (
    <main className="login">
      <section className="loginCard">
        <div className="ball">⚽</div>

        <p className="eyebrow">World Cup 2026</p>

        <h1>Approval Required</h1>

        <p className="muted">Your account has been created successfully.</p>

        <p className="muted">
          Please wait, admin will approve your account and you can access the
          prediction portal.
        </p>

        <button className="primary" onClick={() => signOut(auth)}>
          Logout
        </button>
      </section>
    </main>
  );
}

function Matches({ matches, predictions, uid, profile }) {
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
      <ChampionPick matches={matches} uid={uid} profile={profile} />
      {matches.length > 0 && (
        <button className="jumpButton" onClick={jumpToCurrentMatchDay}>
          Next match ↓
        </button>
      )}

      {Object.entries(grouped).map(([day, list]) => {
        const dayId = `day-${day.replaceAll(" ", "-").replaceAll(",", "")}`;

        return (
          <div key={day} id={dayId}>
            <h2 className="day"> {day}</h2>

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

function PublicPredictions({ matches, users }) {
  const [predictionTab, setPredictionTab] = useState("matches");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const selectedMatch =
    matches.find((match) => match.id === selectedMatchId) || null;

  useEffect(() => {
    if (selectedMatchId || matches.length === 0) return;

    const now = Date.now();

    const latestStartedMatch = [...matches]
      .filter((match) => new Date(match.kickoff).getTime() <= now)
      .sort(
        (a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime(),
      )[0];

    if (latestStartedMatch) {
      setSelectedMatchId(latestStartedMatch.id);
    }
  }, [matches, selectedMatchId]);

  const groupedMatches = matches.reduce((acc, match) => {
    const round = match.round || "Other Matches";
    (acc[round] ||= []).push(match);
    return acc;
  }, {});

  useEffect(() => {
    async function loadPredictions() {
      if (!selectedMatchId || !selectedMatch) {
        setRows([]);
        return;
      }

      const kickoffPassed =
        new Date(selectedMatch.kickoff).getTime() <= Date.now();

      if (!kickoffPassed) {
        setRows([]);
        return;
      }

      setLoading(true);

      try {
        const snap = await getDocs(
          query(
            collection(db, "predictions"),
            where("matchId", "==", selectedMatchId),
          ),
        );

        const predictions = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));

        const approvedUsers = users.filter((user) => user.approved === true);

        const predictionRows = approvedUsers.map((user) => {
          const prediction = predictions.find((p) => p.uid === user.id);

          if (!prediction) {
            return {
              id: `missing_${user.id}`,
              uid: user.id,
              userName: user.name || "Unknown Player",
              hasPrediction: false,
              homeGoals: null,
              awayGoals: null,
              points: "",
            };
          }

          return {
            ...prediction,
            userName: user.name || "Unknown Player",
            hasPrediction: true,
            points: selectedMatch.resultPublished
              ? scorePrediction(prediction, selectedMatch)
              : "",
          };
        });

        // predictionRows.sort((a, b) => {
        //   const scoreA = `${a.homeGoals}-${a.awayGoals}`;
        //   const scoreB = `${b.homeGoals}-${b.awayGoals}`;

        //   return (
        //     scoreA.localeCompare(scoreB) ||
        //     a.userName.localeCompare(b.userName)
        //   );
        // });
        predictionRows.sort((a, b) => {
          if (a.hasPrediction !== b.hasPrediction) {
            return a.hasPrediction ? -1 : 1;
          }

          const scoreA = a.hasPrediction
            ? `${a.homeGoals}-${a.awayGoals}`
            : "zz";
          const scoreB = b.hasPrediction
            ? `${b.homeGoals}-${b.awayGoals}`
            : "zz";

          return (
            scoreA.localeCompare(scoreB) || a.userName.localeCompare(b.userName)
          );
        });

        setRows(predictionRows);
      } finally {
        setLoading(false);
      }
    }

    loadPredictions();
  }, [selectedMatchId, selectedMatch, users]);

  const kickoffPassed = selectedMatch
    ? new Date(selectedMatch.kickoff).getTime() <= Date.now()
    : false;

  return (
    <section className="card">
      <h2>Picks</h2>

      <nav className="predictionSubTabs">
        <button
          className={predictionTab === "matches" ? "active" : ""}
          onClick={() => setPredictionTab("matches")}
        >
          Match Picks
        </button>

        <button
          className={predictionTab === "champion" ? "active" : ""}
          onClick={() => setPredictionTab("champion")}
        >
          Champion Picks
        </button>
      </nav>

      {predictionTab === "matches" && (
        <>
          <label>
            <select
              value={selectedMatchId}
              onChange={(e) => setSelectedMatchId(e.target.value)}
            >
              <option value="">Choose a match</option>

              {Object.entries(groupedMatches).map(([round, list]) => (
                <optgroup key={round} label={round}>
                  {list.map((match) => (
                    <option key={match.id} value={match.id}>
                      {match.homeTeam} vs {match.awayTeam} —{" "}
                      {formatCentralDateTime(match.kickoff)} CT
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {!selectedMatch && (
            <p className="muted">Select a match to view predictions.</p>
          )}

          {selectedMatch && !kickoffPassed && (
            <p className="countdownBanner closed">
              🔒 Predictions are hidden until kickoff.
            </p>
          )}

          {selectedMatch && kickoffPassed && (
            <>
              <div className="predictionMatchHeader">
                <strong>
                  {selectedMatch.homeTeam} vs {selectedMatch.awayTeam}
                </strong>

                <p className="muted">
                  {selectedMatch.round || "Match"} ·{" "}
                  {formatCentralDateTime(selectedMatch.kickoff)} CT
                </p>

                {selectedMatch.resultPublished && (
                  <p className="result">
                    Final Result: {selectedMatch.homeGoals} -{" "}
                    {selectedMatch.awayGoals}
                  </p>
                )}
              </div>

              {loading && <p className="muted">Loading predictions...</p>}

              {!loading && rows.length === 0 && (
                <p className="muted">No predictions submitted for this match.</p>
              )}
              {!loading && rows.length > 0 && (
                <div className="predictionTableHeader">
                  <span>Player</span>
                  <span>Prediction</span>
                  <span>Points</span>
                </div>
              )}
              {!loading &&
                rows.map((row) => (
                  <div className="publicPredictionRow" key={row.id}>
                    <div className="predictionUser">{row.userName}</div>

                    <div className="predictionScore">
                      {row.hasPrediction
                        ? `${row.homeGoals} - ${row.awayGoals}`
                        : "—"}
                    </div>

                    <div className="predictionPoints">
                      {row.points !== "" ? `${row.points} pts` : ""}
                    </div>
                  </div>
                ))}
            </>
          )}
        </>
      )}

      {predictionTab === "champion" && (
        <ChampionPredictions matches={matches} users={users} />
      )}
    </section>
  );
}

function ChampionPredictions({ matches, users }) {
  const firstKickoff = matches.length
    ? Math.min(...matches.map((match) => new Date(match.kickoff).getTime()))
    : null;

  const locked = firstKickoff ? Date.now() >= firstKickoff : false;

  const rows = users
    .filter((user) => user.approved === true)
    .map((user) => ({
      id: user.id,
      userName: user.name || "Unknown Player",
      championPick: user.championPick || "",
    }))
    .sort((a, b) => {
      const aHasPick = Boolean(a.championPick);
      const bHasPick = Boolean(b.championPick);

      if (aHasPick !== bHasPick) return aHasPick ? -1 : 1;

      return (
        (a.championPick || "zz").localeCompare(b.championPick || "zz") ||
        a.userName.localeCompare(b.userName)
      );
    });

  if (!firstKickoff) {
    return <p className="muted">Champion picks will appear after fixtures are added.</p>;
  }

  if (!locked) {
    return (
      <p className="countdownBanner closed">
        🔒 Champion picks are hidden until the first kickoff.
      </p>
    );
  }

  return (
    <>
      {/* <div className="predictionMatchHeader">
        <strong>World Cup Winner Picks</strong>
        <p className="muted">Champion picks locked after first kickoff.</p>
      </div> */}

      {rows.length === 0 && <p className="muted">No approved players yet.</p>}

      {rows.length > 0 && (
        <div className="championPredictionHeader">
          <span>Player</span>
          <span>Champion Pick</span>
        </div>
      )}

      {rows.map((row) => {
        const flag = flagUrl(row.championPick);

        return (
          <div className="championPredictionRow" key={row.id}>
            <div className="predictionUser">{row.userName}</div>

            <div className="championPredictionTeam">
              {row.championPick ? (
                <>
                  {flag && (
                    <img
                      src={flag}
                      alt={row.championPick}
                      className="teamFlag"
                    />
                  )}
                  <strong>{row.championPick}</strong>
                </>
              ) : (
                <span>No pick submitted</span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ChampionPick({ matches, uid, profile }) {
  const [team, setTeam] = useState(profile?.championPick || "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTeam(profile?.championPick || "");
  }, [profile?.championPick]);

  const teams = Array.from(
    new Set(
      matches
        .flatMap((match) => [match.homeTeam, match.awayTeam])
        .filter(Boolean),
    ),
  ).sort();

  const firstKickoff = matches.length
    ? Math.min(...matches.map((match) => new Date(match.kickoff).getTime()))
    : null;

  const locked = firstKickoff ? Date.now() >= firstKickoff : false;

  async function saveChampionPick() {
    if (locked)
      return alert("Champion pick is locked after the first kickoff.");
    if (!team) return alert("Please select a team.");

    await setDoc(
      doc(db, "users", uid),
      {
        championPick: team,
        championPickUpdatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <article className="card">
      <h2>World Cup Winner Pick</h2>
      {profile?.championPick && (
        <div className="championSelected">
          Your current pick: <strong>{profile.championPick}</strong>
        </div>
      )}

      <p className="muted">
        Pick your World Cup winner. You can change it until the first match
        kicks off. Correct pick earns 10 bonus points.
      </p>

      <label>
        Your champion
        <select
          value={team}
          disabled={locked}
          onChange={(e) => setTeam(e.target.value)}
        >
          <option value="">Select team</option>
          {teams.map((teamName) => (
            <option key={teamName} value={teamName}>
              {teamName}
            </option>
          ))}
        </select>
      </label>

      {/* {locked && <p className="countdownBanner closed">🔒 Champion pick locked</p>} */}
      {saved && <p className="success">✅ Champion pick saved</p>}

      {!locked ? (
        <button
          className={profile?.championPick ? "championSavedButton" : "primary"}
          onClick={saveChampionPick}
          disabled={!team}
        >
          {profile?.championPick
            ? "✏️ Edit Champion Pick"
            : "🏆 Save Champion Pick"}
        </button>
      ) : (
        <div className="championLocked">🔒 Champion Pick Locked</div>
      )}
    </article>
  );
}

function ChampionAdmin({ matches, worldCupSettings }) {
  const [winner, setWinner] = useState(worldCupSettings?.championTeam || "");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWinner(worldCupSettings?.championTeam || "");
  }, [worldCupSettings?.championTeam]);

  const teams = Array.from(
    new Set(
      matches
        .flatMap((match) => [match.homeTeam, match.awayTeam])
        .filter(Boolean),
    ),
  ).sort();

  async function publishChampion() {
    if (!winner) return alert("Please select the World Cup winner.");

    setBusy(true);

    try {
      await setDoc(
        doc(db, "settings", "worldCup"),
        {
          championTeam: winner,
          championPublished: true,
          championPublishedAt: serverTimestamp(),
        },
        { merge: true },
      );

      await recalculateLeaderboard();

      setSaved("✅ Champion published and leaderboard updated");
      setTimeout(() => setSaved(""), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function unpublishChampion() {
    setBusy(true);

    try {
      await setDoc(
        doc(db, "settings", "worldCup"),
        {
          championPublished: false,
          championTeam: "",
          championPublishedAt: null,
        },
        { merge: true },
      );

      await recalculateLeaderboard();

      setSaved("↩️ Champion unpublished and leaderboard updated");
      setTimeout(() => setSaved(""), 3000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <h2>🏆 Publish World Cup Winner</h2>

      <label>
        Winning team
        <select value={winner} onChange={(e) => setWinner(e.target.value)}>
          <option value="">Select winner</option>
          {teams.map((teamName) => (
            <option key={teamName} value={teamName}>
              {teamName}
            </option>
          ))}
        </select>
      </label>

      {saved && <p className="success">{saved}</p>}

      <div className="championActions">
        <button
          className="primary"
          onClick={publishChampion}
          disabled={busy || !winner}
        >
          {busy ? "Updating..." : "Publish Champion"}
        </button>

        <button
          className="danger"
          onClick={unpublishChampion}
          disabled={busy || !worldCupSettings?.championPublished}
        >
          Unpublish Champion
        </button>
      </div>
    </article>
  );
}

function MatchCard({ match, prediction, uid }) {
  const lockTime =
    new Date(match.kickoff).getTime() - LOCK_MINUTES_BEFORE_KICKOFF * 60 * 1000;

  const [now, setNow] = useState(Date.now());
  const locked = now >= lockTime;
  const countdownText = formatCountdown(lockTime - now);

  const [homeGoals, setHomeGoals] = useState(prediction?.homeGoals ?? "");
  const [awayGoals, setAwayGoals] = useState(prediction?.awayGoals ?? "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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
        <div className="teamName">
          <img
            src={flagUrl(match.homeTeam)}
            alt={match.homeTeam}
            className="teamFlag"
          />
          <strong>{match.homeTeam}</strong>
        </div>

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

        <div className="teamName">
          <img
            src={flagUrl(match.awayTeam)}
            alt={match.awayTeam}
            className="teamFlag"
          />
          <strong>{match.awayTeam}</strong>
        </div>
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
      <div className="leaderboardHeader">
        <h2>Leaderboard</h2>

        <span className="leaderboardSummary">👥 {rows.length} Players</span>
      </div>

      {rows.map((row, index) => (
        <div className="rank" key={row.id}>
          <img
            src={
              row.photoURL ||
              "https://ui-avatars.com/api/?name=" +
                encodeURIComponent(row.name || "Player")
            }
            alt={row.name || "Player"}
            className="leaderboardAvatar"
          />

          <div>
            <strong>
              #{index + 1} {row.name || "Player"}
            </strong>
            <p>
              {row.place || "No place"} · {row.exact} exact scores
            </p>
          </div>

          <b>{row.points} pts</b>
        </div>
      ))}

      {rows.length === 0 && <Empty text="No players yet." />}
    </section>
  );
}

function Rules() {
  return (
    <section className="card">
      <h2>📜 Tournament Rules</h2>

      <div className="rulesList">
        <div className="ruleItem">
          <strong>⚽ Match Prediction</strong>
          <p>Predict the score for every World Cup match before kickoff.</p>
        </div>
        <div className="ruleItem">
          <strong>⏱️ 90-Minute Rule</strong>
          <p>
            All score predictions are based on the result at the end of regular
            time (90 minutes plus injury time). Extra time and penalty shootouts
            are not included in score prediction scoring.
          </p>
        </div>

        <div className="ruleItem">
          <strong>🎯 Exact Score</strong>
          <p>
            Correct scoreline earns <b>4 points</b>.
          </p>
        </div>

        <div className="ruleItem">
          <strong>🏆 Correct Result</strong>
          <p>
            Correct winner or draw earns <b>2 points</b>.
          </p>
        </div>

        <div className="ruleItem">
          <strong>❌ Incorrect Result</strong>
          <p>
            Wrong prediction earns <b>0 points</b>.
          </p>
        </div>

        <div className="ruleItem">
          <strong>🌎 World Cup Champion Pick</strong>
          <p>Select your World Cup winner before the first match begins.</p>
        </div>

        <div className="ruleItem">
          <strong>🥇 Champion Bonus</strong>
          <p>
            Correct World Cup winner earns <b>10 bonus points</b>.
          </p>
        </div>

        <div className="ruleItem">
          <strong>🔒 Prediction Lock</strong>
          <p>Match predictions lock at kickoff time.</p>
        </div>

        <div className="ruleItem">
          <strong>🕒 Time Zone</strong>
          <p>All match times are displayed in Central Time (CT).</p>
        </div>

        <div className="ruleItem">
          <strong>📊 Leaderboard Ranking</strong>
          <p>
            Players are ranked by total points. Exact score count is used as a
            tiebreaker.
          </p>
        </div>

        <div className="ruleItem">
          <strong>💰 Entry Fee & Prize Pool</strong>

          <p>
            Entry fee is <b>$50 per participant</b>.
          </p>

          <p>The total prize pool is distributed among the top 5 players:</p>

          <ul className="prizeList">
            <li>🥇 1st Place → 45%</li>
            <li>🥈 2nd Place → 25%</li>
            <li>🥉 3rd Place → 15%</li>
            <li>🏅 4th Place → 10%</li>
            <li>🎖️ 5th Place → 5%</li>
          </ul>

          <p>
            If two or more players tie for a position, the prize amount for
            those positions will be distributed equally among the tied players.
          </p>
        </div>
        <div className="ruleItem">
          <strong>⚠️ Anti-Cheating Rule</strong>

          <p>
            Cheating or exploiting any vulnerability of the system is illegal
            and the perpetrator will be expelled from the league without refund.
          </p>
        </div>
      </div>
    </section>
  );
}

function Profile({ profile, uid }) {
  const [form, setForm] = useState({
    name: "",
    place: "",
  });

  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!profile) return;

    setForm({
      name: profile.name || "",
      place: profile.place || "",
    });
  }, [profile]);

  async function save() {
    await setDoc(doc(db, "users", uid), form, { merge: true });

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <section className="card">
      <div className="profileHeader">
        <img
          src={profile?.photoURL}
          alt={profile?.name}
          className="profileAvatar"
        />

        <div>
          <h2>{profile?.name || "Player"}</h2>
          <p className="muted">{profile?.email}</p>
        </div>
      </div>
      <h2>Your profile</h2>

      <label>
        Name
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>

      <label>
        Place
        <input
          value={form.place}
          onChange={(e) => setForm({ ...form, place: e.target.value })}
        />
      </label>

      {saved && <p className="success">✅ Profile saved</p>}

      <button className="primary" onClick={save}>
        Save profile
      </button>
    </section>
  );
}

function UserApprovals({ users }) {
  const [userTab, setUserTab] = useState("approvals");
  const pendingUsers = users.filter((user) => user.approved !== true);
  const approvedUsers = users.filter((user) => user.approved === true);
  // const pendingUsers = users.filter(user => !user.approved);

  async function setApproval(user, approved) {
    const nextUserState = {
      approved,
      approvedAt: approved ? serverTimestamp() : null,
    };

    if (approved && !user.paymentStatus) {
      nextUserState.paymentStatus = PAYMENT_STATUS_UNPAID;
      nextUserState.entryFeePaid = false;
    }

    await setDoc(
      doc(db, "users", user.id),
      nextUserState,
      { merge: true },
    );
  }

  return (
    <article className="card">
      <h2>👥 Users</h2>

      <nav className="userSubTabs">
        <button
          className={userTab === "approvals" ? "active" : ""}
          onClick={() => setUserTab("approvals")}
        >
          Approvals
        </button>

        <button
          className={userTab === "payments" ? "active" : ""}
          onClick={() => setUserTab("payments")}
        >
          Payments
        </button>
      </nav>

      {userTab === "approvals" && (
        <>
          <h3>⏳ Pending Approval</h3>

          {pendingUsers.length === 0 && (
            <p className="muted">No pending users.</p>
          )}

          {pendingUsers.map((user) => (
            <div className="approvalRow" key={user.id}>
              <div>
                <strong>{user.name || "Unknown User"}</strong>
                <p className="muted">{user.email}</p>
              </div>

              <div className="approvalActions">
                <button
                  className="secondary"
                  onClick={() => setApproval(user, true)}
                >
                  Approve
                </button>
              </div>
            </div>
          ))}

          <h3 style={{ marginTop: "24px" }}>✅ Approved Users</h3>

          {approvedUsers.length === 0 && (
            <p className="muted">No approved users.</p>
          )}

          {approvedUsers.map((user) => (
            <div className="approvalRow" key={user.id}>
              <div>
                <strong>{user.name || "Unknown User"}</strong>
                <p className="muted">{user.email}</p>
              </div>

              <div className="approvalActions">
                <button
                  className="danger"
                  onClick={() => setApproval(user, false)}
                >
                  Remove Access
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {userTab === "payments" && <UserPayments users={approvedUsers} />}
    </article>
  );
}

function UserPayments({ users }) {
  const sortedUsers = [...users].sort((a, b) =>
    (a.name || a.email || "").localeCompare(b.name || b.email || ""),
  );

  async function setPaymentStatus(userId, paymentStatus) {
    await setDoc(
      doc(db, "users", userId),
      {
        paymentStatus,
        entryFeePaid: paymentStatus === PAYMENT_STATUS_PAID,
        paymentStatusUpdatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (sortedUsers.length === 0) {
    return <p className="muted">No approved users.</p>;
  }

  return (
    <div className="paymentList">
      {sortedUsers.map((user) => {
        const isPaid = user.paymentStatus === PAYMENT_STATUS_PAID;

        return (
          <div className="paymentRow" key={user.id}>
            <div>
              <strong>{user.name || "Unknown User"}</strong>
              <p className="muted">{user.email}</p>
            </div>

            <span
              className={
                isPaid
                  ? "paymentStatusBadge paid"
                  : "paymentStatusBadge unpaid"
              }
            >
              {isPaid ? "Paid" : "Unpaid"}
            </span>

            <div className="paymentControls">
              <button
                className={isPaid ? "paymentOption active" : "paymentOption"}
                onClick={() => setPaymentStatus(user.id, PAYMENT_STATUS_PAID)}
              >
                Paid
              </button>

              <button
                className={!isPaid ? "paymentOption active" : "paymentOption"}
                onClick={() => setPaymentStatus(user.id, PAYMENT_STATUS_UNPAID)}
              >
                Unpaid
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Admin({ matches, users, worldCupSettings }) {
  const [adminTab, setAdminTab] = useState("create");
  const nextMatchNumber = matches.length + 1;
  const [search, setSearch] = useState("");
  const [match, setMatch] = useState({
    id: "",
    homeTeam: "",
    awayTeam: "",
    kickoff: "",
    round: "",
  });

  const [leaderboardSaved, setLeaderboardSaved] = useState("");
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);
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

  async function updateLeaderboardNow() {
    setLeaderboardBusy(true);

    try {
      await recalculateLeaderboard();

      setLeaderboardSaved("✅ Leaderboard updated");
      setTimeout(() => setLeaderboardSaved(""), 3000);
    } finally {
      setLeaderboardBusy(false);
    }
  }

  const filteredMatches = matches.filter((match) => {
    const text =
      `${match.homeTeam} ${match.awayTeam} ${match.round}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });
  return (
    <section>
      <nav className="adminTabs">
        <button
          className={adminTab === "create" ? "active" : ""}
          onClick={() => setAdminTab("create")}
        >
          ➕ Create
        </button>

        <button
          className={adminTab === "results" ? "active" : ""}
          onClick={() => setAdminTab("results")}
        >
          ⚽ Results
        </button>

        <button
          className={adminTab === "users" ? "active" : ""}
          onClick={() => setAdminTab("users")}
        >
          👥 Users
        </button>

        <button
          className={adminTab === "leaderboard" ? "active" : ""}
          onClick={() => setAdminTab("leaderboard")}
        >
          📊 Board
        </button>

        <button
          className={adminTab === "champion" ? "active" : ""}
          onClick={() => setAdminTab("champion")}
        >
          🏆 Winner
        </button>
      </nav>
      {adminTab === "create" && (
        <article className="card">
          <h2>Create match</h2>

          <label>
            Match ID
            <input
              placeholder={`match${String(nextMatchNumber).padStart(3, "0")}`}
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
      )}
      {adminTab === "leaderboard" && (
        <article className="card">
          <h2>📊 Leaderboard</h2>

          <p className="muted">
            Recalculate all match points, exact score counts, and champion bonus
            points.
          </p>

          {leaderboardSaved && <p className="success">{leaderboardSaved}</p>}

          <button
            className="primary"
            onClick={updateLeaderboardNow}
            disabled={leaderboardBusy}
          >
            {leaderboardBusy ? "Updating leaderboard..." : "Update Leaderboard"}
          </button>
        </article>
      )}
      {adminTab === "champion" && (
        <ChampionAdmin matches={matches} worldCupSettings={worldCupSettings} />
      )}

      {adminTab === "users" && <UserApprovals users={users} />}

      {adminTab === "results" && (
        <>
          <article className="card">
            <label>
              Search matches
              <input
                placeholder="Search Argentina, Group A, Brazil..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </article>
          <h2 className="day">Publish results</h2>

          {filteredMatches.map((match, index) => (
            <AdminResult
              key={match.id}
              match={match}
              displayNumber={index + 1}
            />
          ))}
        </>
      )}
    </section>
  );
}

async function recalculateLeaderboard() {
  const settingsSnap = await getDoc(doc(db, "settings", "worldCup"));
  const settings = settingsSnap.exists() ? settingsSnap.data() : null;
  const championTeam = settings?.championPublished ? settings.championTeam : "";

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

    const championBonusPoints =
      championTeam && user.championPick === championTeam ? 10 : 0;

    batch.set(
      doc(db, "users", user.id),
      {
        totalPoints: totalPoints + championBonusPoints,
        matchPoints: totalPoints,
        championBonusPoints,
        exactScores,
        leaderboardUpdatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  });

  await batch.commit();
}

function AdminResult({ match, displayNumber }) {
  const [editing, setEditing] = useState(false);
  const [homeTeam, setHomeTeam] = useState(match.homeTeam ?? "");
  const [awayTeam, setAwayTeam] = useState(match.awayTeam ?? "");
  const [round, setRound] = useState(match.round ?? "");
  const [kickoff, setKickoff] = useState(toLocalInputValue(match.kickoff));
  const [homeGoals, setHomeGoals] = useState(match.homeGoals ?? "");
  const [awayGoals, setAwayGoals] = useState(match.awayGoals ?? "");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

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

  async function publish() {
    if (homeGoals === "" || awayGoals === "") {
      return alert("Please enter both final scores.");
    }

    setBusy(true);

    try {
      await updateDoc(doc(db, "matches", match.id), {
        homeGoals: Number(homeGoals),
        awayGoals: Number(awayGoals),
        resultPublished: true,
        updatedAt: serverTimestamp(),
      });

      await recalculateLeaderboard();

      setSaved("✅ Result published and leaderboard updated");
      setTimeout(() => setSaved(""), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);

    try {
      await updateDoc(doc(db, "matches", match.id), {
        resultPublished: false,
        updatedAt: serverTimestamp(),
      });

      await recalculateLeaderboard();

      setSaved("↩️ Result unpublished and leaderboard updated");
      setTimeout(() => setSaved(""), 3000);
    } finally {
      setBusy(false);
    }
  }

  async function removeMatch() {
    if (!confirm(`Delete ${match.homeTeam} vs ${match.awayTeam}?`)) return;

    await deleteDoc(doc(db, "matches", match.id));
    await recalculateLeaderboard();
  }

  // async function sendEmailNotification() {
  //   setBusy(true);
  //   try {
  //     const usersSnap = await getDocs(collection(db, 'users'));
  //     const predictionsSnap = await getDocs(
  //       query(collection(db, 'predictions'), where('matchId', '==', match.id))
  //     );

  //     const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  //     const matchPredictions = predictionsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  //     const bccEmails = allUsers.map(u => u.email).filter(Boolean);

  //     if (bccEmails.length === 0) {
  //       alert('No users to notify.');
  //       setBusy(false);
  //       return;
  //     }

  //     const predictions = matchPredictions
  //       .map(p => {
  //         const user = allUsers.find(u => u.id === p.uid);
  //         return {
  //           playerName: user?.name || 'Anonymous',
  //           homeGoals: p.homeGoals ?? '-',
  //           awayGoals: p.awayGoals ?? '-'
  //         };
  //       })
  //       .sort((a, b) => a.playerName.localeCompare(b.playerName));

  //     const matchData = {
  //       homeTeam: match.homeTeam,
  //       awayTeam: match.awayTeam,
  //       kickoff: formatCentralDateTime(match.kickoff)
  //     };

  //     const response = await fetch('/api/send-email', {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json'
  //       },
  //       body: JSON.stringify({
  //         toEmail: import.meta.env.VITE_SENDGRID_TO_EMAIL,
  //         bccEmails,
  //         matchData,
  //         predictions
  //       })
  //     });

  //     if (!response.ok) {
  //       throw new Error('Failed to send email');
  //     }

  //     setSaved(`✅ Email sent`);
  //     setTimeout(() => setSaved(''), 2500);
  //   } catch (error) {
  //     alert(`Error sending emails: ${error.message}`);
  //   } finally {
  //     setBusy(false);
  //   }
  // }

  async function sendEmailNotification() {
    setBusy(true);

    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const predictionsSnap = await getDocs(
        query(collection(db, "predictions"), where("matchId", "==", match.id)),
      );

      const allUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const matchPredictions = predictionsSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      const approvedUsers = allUsers
        .filter((user) => user.approved === true)
        .sort((a, b) =>
          (a.name || a.email || "").localeCompare(b.name || b.email || ""),
        );

      if (approvedUsers.length === 0) {
        alert("No approved users to notify.");
        return;
      }

      const bccEmails = approvedUsers.map((u) => u.email).filter(Boolean);

      if (bccEmails.length === 0) {
        alert("No approved users with email addresses to notify.");
        return;
      }

      const predictionByUserId = new Map(
        matchPredictions.map((prediction) => [prediction.uid, prediction]),
      );

      const predictions = approvedUsers.map((user) => {
        const prediction = predictionByUserId.get(user.id);

        return {
          playerName: user.name || user.email || "Anonymous",
          hasPrediction: Boolean(prediction),
          homeGoals: prediction?.homeGoals,
          awayGoals: prediction?.awayGoals,
        };
      });

      const matchData = {
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoff: formatCentralDateTime(match.kickoff),
      };

      // const predictionText = predictions
      //   .map(
      //     (p) =>
      //       `${p.playerName}: ${matchData.homeTeam} ${p.homeGoals} - ${p.awayGoals} ${matchData.awayTeam}`,
      //   )
      //   .join("\n");
      const escapeEmailHtml = (value) =>
        String(value ?? "").replace(/[&<>"']/g, (char) => {
          const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          };

          return entities[char];
        });

      const safeHomeTeam = escapeEmailHtml(matchData.homeTeam);
      const safeAwayTeam = escapeEmailHtml(matchData.awayTeam);

      const predictionTable = `
<table style="width:100%; border-collapse:collapse; font-family:Arial,sans-serif;">
  <thead>
    <tr style="background-color:#1e3a8a; color:white;">
      <th style="padding:10px; border:1px solid #ddd;">Player</th>
      <th style="padding:10px; border:1px solid #ddd;">Prediction</th>
    </tr>
  </thead>
  <tbody>
    ${predictions
      .map(
        (p, index) => `
        <tr style="background-color:${index % 2 === 0 ? "#f8fafc" : "#ffffff"};">
          <td style="padding:8px; border:1px solid #ddd;">
            ${escapeEmailHtml(p.playerName)}
          </td>
          <td style="padding:8px; border:1px solid #ddd;">
            ${
              p.hasPrediction
                ? `${safeHomeTeam} ${escapeEmailHtml(p.homeGoals)} - ${escapeEmailHtml(p.awayGoals)} ${safeAwayTeam}`
                : '<span style="color:#64748b;">No prediction submitted</span>'
            }
          </td>
        </tr>
      `,
      )
      .join("")}
  </tbody>
</table>
`;

      await emailjs.send(
        import.meta.env.VITE_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
        {
          to_email: import.meta.env.VITE_EMAILJS_TO_EMAIL,
          bcc_emails: bccEmails.join(","),
          home_team: matchData.homeTeam,
          away_team: matchData.awayTeam,
          kickoff: matchData.kickoff,
          predictions: predictionTable,
          subject: `Predictions of Players for ${matchData.homeTeam} vs ${matchData.awayTeam}`,
        },
        {
          publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
        },
      );

      setSaved("Email sent Successfully");
      setTimeout(() => setSaved(""), 2500);
    } catch (error) {
      console.log(error);
      alert(`Error sending emails: ${error.text || error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card compact adminResultCard">
      {!editing ? (
        <>
          <div className="adminResultHeader">
            <div>
              <strong>Match #{displayNumber}</strong>
              <p className="adminTeams">
                {match.homeTeam} vs {match.awayTeam}
              </p>
            </div>

            <span className="matchBadge">{match.round || "Group Stage"}</span>
          </div>

          <p className="muted adminDate">
            {formatCentralDateTime(match.kickoff)} {TIME_ZONE_LABEL}
          </p>

          <div className="adminResultControls">
            <div className="adminScoreInputs">
              <input
                type="number"
                min="0"
                value={homeGoals}
                onChange={(e) => setHomeGoals(e.target.value)}
              />

              <span>-</span>

              <input
                type="number"
                min="0"
                value={awayGoals}
                onChange={(e) => setAwayGoals(e.target.value)}
              />
            </div>

            <div className="adminPublishGroup">
              <button
                className="adminPublishBtn"
                onClick={publish}
                disabled={busy}
              >
                {busy
                  ? "Updating..."
                  : match.resultPublished
                    ? "Update"
                    : "Publish"}
              </button>

              <button
                className="adminUnpublishBtn"
                onClick={unpublish}
                disabled={busy}
              >
                Unpublish
              </button>
            </div>
          </div>

          <div className="adminManageActions">
            <button className="adminSmallBtn" onClick={() => setEditing(true)}>
              Edit Match
            </button>

            {isLocked && (
              <button
                className="adminSmallBtn"
                onClick={sendEmailNotification}
                disabled={busy}
              >
                📧 Send Email
              </button>
            )}

            <button
              className="adminDeleteBtn"
              onClick={removeMatch}
              disabled={busy}
            >
              Delete
            </button>
          </div>
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

          <div className="adminManageActions">
            <button className="adminPublishBtn" onClick={saveMatchDetails}>
              Save
            </button>

            <button className="adminSmallBtn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      )}

      {saved && <p className="success">{saved}</p>}
    </article>
  );
}

function Empty({ text }) {
  return <p className="muted empty">{text}</p>;
}

createRoot(document.getElementById("root")).render(<App />);
