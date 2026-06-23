import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import {
  CheckCircle2,
  Circle,
  Clock,
  Wrench,
  ChevronRight,
  X,
  User,
  Calendar,
  LayoutGrid,
  ClipboardList,
  AlertTriangle,
  Settings,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";

const FREQ_LABELS = {
  daily: { label: "Giornaliera", color: "bg-blue-100 text-blue-700" },
  weekly: { label: "Settimanale", color: "bg-purple-100 text-purple-700" },
  monthly: { label: "Mensile", color: "bg-amber-100 text-amber-700" },
};

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDate(d) {
  return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}

// Determina se un'attività è "dovuta" oggi in base alla frequenza.
// Logica semplice: daily = sempre; weekly = ogni lunedì; monthly = il giorno 1 del mese.
// Se vuoi una logica diversa, modifica qui.
function isDueToday(task) {
  const day = new Date().getDay(); // 0=domenica..6=sabato
  const date = new Date().getDate();
  if (task.frequency === "daily") return true;
  if (task.frequency === "weekly") return day === 1; // lunedì
  if (task.frequency === "monthly") return date === 1;
  return true;
}

export default function App() {
  const [view, setView] = useState("operatore");
  const [machines, setMachines] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [completions, setCompletions] = useState({}); // taskId -> {time, operator}
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: machinesData }, { data: tasksData }, { data: completionsData }] =
      await Promise.all([
        supabase.from("machines").select("*").order("created_at"),
        supabase.from("tasks").select("*").order("created_at"),
        supabase
          .from("task_completions")
          .select("*")
          .eq("completion_date", todayStr()),
      ]);

    setMachines(machinesData || []);
    setTasks(tasksData || []);

    const compMap = {};
    (completionsData || []).forEach((c) => {
      compMap[c.task_id] = {
        time: new Date(c.completed_at).toLocaleTimeString("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        operator: c.operator_name,
      };
    });
    setCompletions(compMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: ricarica le completions quando cambia qualcosa nel DB
  useEffect(() => {
    const channel = supabase
      .channel("realtime-completions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_completions" },
        () => {
          loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "machines" },
        () => {
          loadData();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => {
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  async function confirmTask(task, operatorName) {
    const now = new Date();
    await supabase.from("task_completions").insert({
      task_id: task.id,
      completion_date: todayStr(),
      operator_name: operatorName,
    });
    // Optimistic update locale, il realtime poi confermerà
    setCompletions((prev) => ({
      ...prev,
      [task.id]: {
        time: now.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
        operator: operatorName,
      },
    }));
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="bg-slate-900 px-4 py-2 flex items-center justify-center gap-2 flex-wrap">
        <button
          onClick={() => setView("operatore")}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${
            view === "operatore" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          Operatore
        </button>
        <button
          onClick={() => setView("supervisore")}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${
            view === "supervisore" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          Supervisore
        </button>
        <button
          onClick={() => setView("impostazioni")}
          className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${
            view === "impostazioni" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          <Settings className="w-4 h-4" />
          Impostazioni
        </button>
      </div>

      {view === "operatore" && (
        <OperatorView
          machines={machines}
          tasks={tasks}
          completions={completions}
          onConfirm={confirmTask}
        />
      )}
      {view === "supervisore" && (
        <SupervisorView machines={machines} tasks={tasks} completions={completions} />
      )}
      {view === "impostazioni" && (
        <SettingsView machines={machines} tasks={tasks} onChange={loadData} />
      )}
    </div>
  );
}

// ============ OPERATOR VIEW ============
function OperatorView({ machines, tasks, completions, onConfirm }) {
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [activeTask, setActiveTask] = useState(null);
  const [checkedItems, setCheckedItems] = useState({});
  const [operatorName, setOperatorName] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingConfirmTask, setPendingConfirmTask] = useState(null);

  const today = new Date();

  const machineTasks = selectedMachine
    ? tasks.filter((t) => t.machine_id === selectedMachine.id && isDueToday(t))
    : [];
  const doneCount = machineTasks.filter((t) => completions[t.id]).length;
  const progressPct = machineTasks.length
    ? Math.round((doneCount / machineTasks.length) * 100)
    : 0;

  function openTask(task) {
    setActiveTask(task);
    setCheckedItems({});
  }
  function closeTask() {
    setActiveTask(null);
    setCheckedItems({});
  }
  function toggleChecklistItem(idx) {
    setCheckedItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }
  function requestConfirm(task) {
    if (!operatorName) {
      setPendingConfirmTask(task);
      setShowNamePrompt(true);
      return;
    }
    doConfirm(task, operatorName);
  }
  function doConfirm(task, name) {
    onConfirm(task, name);
    closeTask();
  }
  function handleNameSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!operatorName.trim()) return;
    setShowNamePrompt(false);
    if (pendingConfirmTask) {
      doConfirm(pendingConfirmTask, operatorName);
      setPendingConfirmTask(null);
    }
  }

  const checklist = activeTask ? activeTask.checklist || [] : [];
  const allChecked =
    activeTask && checklist.length > 0 && checklist.every((_, idx) => checkedItems[idx]);

  if (!selectedMachine) {
    return (
      <div className="flex flex-col">
        <header className="bg-slate-900 text-white px-6 py-5">
          <div className="flex items-center gap-3">
            <Wrench className="w-7 h-7 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold">Automanutenzione</h1>
              <p className="text-slate-400 text-sm capitalize">{formatDate(today)}</p>
            </div>
          </div>
        </header>
        <main className="flex-1 px-6 py-8 max-w-2xl mx-auto w-full">
          <h2 className="text-lg font-semibold text-slate-700 mb-4">Seleziona la tua macchina</h2>
          {machines.length === 0 ? (
            <p className="text-slate-400">Nessuna macchina configurata. Vai su Impostazioni.</p>
          ) : (
            <div className="grid gap-3">
              {machines.map((m) => {
                const mTasks = tasks.filter((t) => t.machine_id === m.id && isDueToday(t));
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMachine(m)}
                    className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between hover:border-blue-400 hover:shadow-md transition-all text-left active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
                        <Wrench className="w-6 h-6 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800">{m.name}</p>
                        <p className="text-sm text-slate-500">{m.code} · {mTasks.length} attività oggi</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  </button>
                );
              })}
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <header className="bg-slate-900 text-white px-6 py-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedMachine(null)}
            className="text-slate-400 hover:text-white text-sm font-medium"
          >
            ← Cambia macchina
          </button>
          <div className="flex items-center gap-2 text-slate-300 text-sm">
            <Calendar className="w-4 h-4" />
            <span className="capitalize">{formatDate(today)}</span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Wrench className="w-7 h-7 text-blue-400" />
          <div>
            <h1 className="text-xl font-bold">{selectedMachine.name}</h1>
            <p className="text-slate-400 text-sm">{selectedMachine.code}</p>
          </div>
        </div>
      </header>

      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-2xl mx-auto w-full">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-slate-600">
              {doneCount} di {machineTasks.length} attività completate
            </span>
            <span className="text-sm font-bold text-slate-800">{progressPct}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500 rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {operatorName && (
            <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <User className="w-4 h-4" />
              <span>Operatore: {operatorName}</span>
            </div>
          )}
        </div>
      </div>

      <main className="flex-1 px-6 py-6 max-w-2xl mx-auto w-full">
        {machineTasks.length === 0 ? (
          <div className="text-center text-slate-400 py-12">
            Nessuna attività di automanutenzione prevista oggi.
          </div>
        ) : (
          <div className="space-y-3">
            {machineTasks.map((task) => {
              const isDone = completions[task.id];
              const freq = FREQ_LABELS[task.frequency];
              return (
                <button
                  key={task.id}
                  onClick={() => openTask(task)}
                  className={`w-full text-left bg-white border rounded-xl px-5 py-4 flex items-center gap-4 transition-all hover:shadow-md active:scale-[0.99] ${
                    isDone ? "border-green-300 bg-green-50/50" : "border-slate-200"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="w-7 h-7 text-green-500 shrink-0" />
                  ) : (
                    <Circle className="w-7 h-7 text-slate-300 shrink-0" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${freq.color}`}>
                        {freq.label}
                      </span>
                      {isDone && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {isDone.time}
                        </span>
                      )}
                    </div>
                    <p className={`font-medium ${isDone ? "text-slate-500 line-through" : "text-slate-800"}`}>
                      {task.title}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />
                </button>
              );
            })}
          </div>
        )}

        {machineTasks.length > 0 && doneCount === machineTasks.length && (
          <div className="mt-6 bg-green-100 border border-green-300 rounded-xl px-5 py-4 text-center">
            <p className="text-green-800 font-semibold">🎉 Tutte le attività di oggi sono state completate!</p>
          </div>
        )}
      </main>

      {activeTask && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${FREQ_LABELS[activeTask.frequency].color}`}>
                {FREQ_LABELS[activeTask.frequency].label}
              </span>
              <button onClick={closeTask} className="text-slate-400 hover:text-slate-700">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="px-5 py-5">
              <h2 className="text-lg font-bold text-slate-800 mb-2">{activeTask.title}</h2>
              <p className="text-slate-600 text-sm mb-5">{activeTask.description}</p>

              {completions[activeTask.id] ? (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3 mb-4">
                  <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-green-800">Attività già completata</p>
                    <p className="text-green-600">
                      alle {completions[activeTask.id].time} da {completions[activeTask.id].operator}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {checklist.length > 0 && (
                    <div className="mb-5">
                      <p className="text-sm font-semibold text-slate-700 mb-2">Checklist</p>
                      <div className="space-y-2">
                        {checklist.map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => toggleChecklistItem(idx)}
                            className="w-full flex items-center gap-3 text-left bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2.5 transition-colors"
                          >
                            {checkedItems[idx] ? (
                              <CheckCircle2 className="w-5 h-5 text-blue-500 shrink-0" />
                            ) : (
                              <Circle className="w-5 h-5 text-slate-300 shrink-0" />
                            )}
                            <span className={`text-sm ${checkedItems[idx] ? "text-slate-400 line-through" : "text-slate-700"}`}>
                              {item}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => requestConfirm(activeTask)}
                    disabled={checklist.length > 0 && !allChecked}
                    className={`w-full py-3.5 rounded-xl font-semibold text-white transition-colors ${
                      checklist.length > 0 && !allChecked
                        ? "bg-slate-300 cursor-not-allowed"
                        : "bg-green-600 hover:bg-green-700"
                    }`}
                  >
                    Conferma esecuzione
                  </button>
                  {checklist.length > 0 && !allChecked && (
                    <p className="text-xs text-slate-400 text-center mt-2">
                      Completa tutti i punti della checklist per confermare
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showNamePrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="font-bold text-slate-800">Chi sei?</h3>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              Inserisci il tuo nome per registrare l'esecuzione dell'attività.
            </p>
            <input
              autoFocus
              type="text"
              value={operatorName}
              onChange={(e) => setOperatorName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNameSubmit(e);
              }}
              placeholder="Nome operatore"
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={handleNameSubmit}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              Conferma
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ SUPERVISOR VIEW ============
function SupervisorView({ machines, tasks, completions }) {
  const [selectedMachine, setSelectedMachine] = useState(null);
  const today = new Date();

  function machineStatus(machine) {
    const mTasks = tasks.filter((t) => t.machine_id === machine.id && isDueToday(t));
    const done = mTasks.filter((t) => completions[t.id]).length;
    return { total: mTasks.length, done, ok: mTasks.length > 0 && done === mTasks.length };
  }

  const machinesOk = machines.filter((m) => machineStatus(m).ok).length;

  return (
    <div className="flex flex-col">
      <header className="bg-slate-900 text-white px-6 py-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <LayoutGrid className="w-7 h-7 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold">Dashboard Supervisore</h1>
              <p className="text-slate-400 text-sm capitalize">{formatDate(today)}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 bg-slate-800 rounded-xl px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-sm text-slate-200">{machinesOk} in regola</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-sm text-slate-200">{machines.length - machinesOk} da fare</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-4xl mx-auto w-full">
        <p className="text-sm text-slate-500 mb-4">
          Layout officina — clicca su una macchina per i dettagli
        </p>

        <div
          className="relative w-full bg-white border-2 border-slate-200 rounded-2xl overflow-hidden"
          style={{ paddingBottom: "60%" }}
        >
          <div className="absolute inset-0">
            <div className="absolute top-0 left-1/2 w-px h-full bg-slate-100" />
            <div className="absolute top-1/2 left-0 w-full h-px bg-slate-100" />
          </div>

          {machines.map((m) => {
            const status = machineStatus(m);
            return (
              <button
                key={m.id}
                onClick={() => setSelectedMachine(m)}
                className={`absolute rounded-xl border-2 flex flex-col items-center justify-center gap-1.5 transition-all hover:scale-[1.03] hover:shadow-lg active:scale-100 ${
                  status.ok ? "bg-green-500 border-green-600" : "bg-red-500 border-red-600"
                }`}
                style={{
                  left: `${m.pos_x}%`,
                  top: `${m.pos_y}%`,
                  width: `${m.pos_w}%`,
                  height: `${m.pos_h}%`,
                }}
              >
                <Wrench className="w-6 h-6 text-white" />
                <span className="text-white font-semibold text-sm text-center px-2">{m.name}</span>
                <span className="text-white/90 text-xs">
                  {status.done}/{status.total} attività
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-6 mt-4">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded bg-green-500" />
            <span className="text-sm text-slate-600">Automanutenzione completata</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded bg-red-500" />
            <span className="text-sm text-slate-600">Automanutenzione da eseguire</span>
          </div>
        </div>
      </main>

      {selectedMachine && (
        <MachineDetailModal
          machine={selectedMachine}
          tasks={tasks.filter((t) => t.machine_id === selectedMachine.id && isDueToday(t))}
          completions={completions}
          onClose={() => setSelectedMachine(null)}
        />
      )}
    </div>
  );
}

function MachineDetailModal({ machine, tasks, completions, onClose }) {
  const doneCount = tasks.filter((t) => completions[t.id]).length;
  const allDone = tasks.length > 0 && doneCount === tasks.length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <div className={`sticky top-0 px-5 py-4 flex items-center justify-between ${allDone ? "bg-green-600" : "bg-red-600"}`}>
          <div className="flex items-center gap-2 text-white">
            <Wrench className="w-5 h-5" />
            <div>
              <p className="font-bold">{machine.name}</p>
              <p className="text-xs text-white/80">{machine.code}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-slate-600">
              {doneCount} di {tasks.length} attività completate oggi
            </span>
            {allDone ? (
              <span className="flex items-center gap-1 text-green-600 text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4" /> In regola
              </span>
            ) : (
              <span className="flex items-center gap-1 text-red-600 text-sm font-semibold">
                <AlertTriangle className="w-4 h-4" /> Incompleta
              </span>
            )}
          </div>

          {tasks.length === 0 ? (
            <p className="text-center text-slate-400 py-8">Nessuna attività prevista oggi.</p>
          ) : (
            <div className="space-y-2.5">
              {tasks.map((task) => {
                const isDone = completions[task.id];
                const freq = FREQ_LABELS[task.frequency];
                return (
                  <div
                    key={task.id}
                    className={`border rounded-xl px-4 py-3 flex items-center gap-3 ${
                      isDone ? "border-green-200 bg-green-50/50" : "border-slate-200"
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0" />
                    ) : (
                      <Circle className="w-6 h-6 text-slate-300 shrink-0" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${freq.color}`}>
                          {freq.label}
                        </span>
                      </div>
                      <p className="font-medium text-slate-800 text-sm">{task.title}</p>
                      {isDone && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Eseguita alle {isDone.time} da {isDone.operator}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ SETTINGS VIEW ============
function SettingsView({ machines, tasks, onChange }) {
  const [editingMachine, setEditingMachine] = useState(null); // null | "new" | machine object
  const [editingTask, setEditingTask] = useState(null); // null | {machineId} | task object
  const [busy, setBusy] = useState(false);

  async function saveMachine(form) {
    setBusy(true);
    if (form.id) {
      await supabase
        .from("machines")
        .update({
          name: form.name,
          code: form.code,
          pos_x: form.pos_x,
          pos_y: form.pos_y,
          pos_w: form.pos_w,
          pos_h: form.pos_h,
        })
        .eq("id", form.id);
    } else {
      await supabase.from("machines").insert({
        name: form.name,
        code: form.code,
        pos_x: form.pos_x,
        pos_y: form.pos_y,
        pos_w: form.pos_w,
        pos_h: form.pos_h,
      });
    }
    setBusy(false);
    setEditingMachine(null);
    onChange();
  }

  async function deleteMachine(id) {
    setBusy(true);
    await supabase.from("machines").delete().eq("id", id);
    setBusy(false);
    onChange();
  }

  async function saveTask(form) {
    setBusy(true);
    const payload = {
      machine_id: form.machine_id,
      title: form.title,
      description: form.description,
      frequency: form.frequency,
      checklist: form.checklist.filter((c) => c.trim() !== ""),
    };
    if (form.id) {
      await supabase.from("tasks").update(payload).eq("id", form.id);
    } else {
      await supabase.from("tasks").insert(payload);
    }
    setBusy(false);
    setEditingTask(null);
    onChange();
  }

  async function deleteTask(id) {
    setBusy(true);
    await supabase.from("tasks").delete().eq("id", id);
    setBusy(false);
    onChange();
  }

  return (
    <div className="flex flex-col">
      <header className="bg-slate-900 text-white px-6 py-5">
        <div className="flex items-center gap-3">
          <Settings className="w-7 h-7 text-blue-400" />
          <h1 className="text-xl font-bold">Impostazioni</h1>
        </div>
      </header>

      <main className="flex-1 px-6 py-6 max-w-3xl mx-auto w-full space-y-8">
        {/* Machines section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-700">Macchine</h2>
            <button
              onClick={() => setEditingMachine("new")}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-2 rounded-lg"
            >
              <Plus className="w-4 h-4" /> Nuova macchina
            </button>
          </div>
          <div className="space-y-2">
            {machines.map((m) => (
              <div
                key={m.id}
                className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="font-medium text-slate-800">{m.name}</p>
                  <p className="text-sm text-slate-500">{m.code}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingMachine(m)}
                    className="text-sm text-blue-600 hover:underline px-2"
                  >
                    Modifica
                  </button>
                  <button
                    onClick={() => deleteMachine(m.id)}
                    className="text-red-500 hover:text-red-700 p-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tasks section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-700">Attività</h2>
            <button
              onClick={() =>
                setEditingTask({
                  machine_id: machines[0]?.id || "",
                  title: "",
                  description: "",
                  frequency: "daily",
                  checklist: [""],
                })
              }
              disabled={machines.length === 0}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm font-medium px-3 py-2 rounded-lg"
            >
              <Plus className="w-4 h-4" /> Nuova attività
            </button>
          </div>

          {machines.map((m) => {
            const mTasks = tasks.filter((t) => t.machine_id === m.id);
            if (mTasks.length === 0) return null;
            return (
              <div key={m.id} className="mb-4">
                <p className="text-sm font-semibold text-slate-500 mb-2">{m.name}</p>
                <div className="space-y-2">
                  {mTasks.map((t) => (
                    <div
                      key={t.id}
                      className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center justify-between"
                    >
                      <div>
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${FREQ_LABELS[t.frequency].color} mr-2`}
                        >
                          {FREQ_LABELS[t.frequency].label}
                        </span>
                        <span className="font-medium text-slate-800">{t.title}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setEditingTask({
                              ...t,
                              checklist:
                                t.checklist && t.checklist.length > 0 ? t.checklist : [""],
                            })
                          }
                          className="text-sm text-blue-600 hover:underline px-2"
                        >
                          Modifica
                        </button>
                        <button
                          onClick={() => deleteTask(t.id)}
                          className="text-red-500 hover:text-red-700 p-1.5"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      </main>

      {editingMachine && (
        <MachineForm
          machine={editingMachine === "new" ? null : editingMachine}
          onSave={saveMachine}
          onCancel={() => setEditingMachine(null)}
          busy={busy}
        />
      )}

      {editingTask && (
        <TaskForm
          task={editingTask}
          machines={machines}
          onSave={saveTask}
          onCancel={() => setEditingTask(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

function MachineForm({ machine, onSave, onCancel, busy }) {
  const [name, setName] = useState(machine?.name || "");
  const [code, setCode] = useState(machine?.code || "");
  const [posX, setPosX] = useState(machine?.pos_x ?? 10);
  const [posY, setPosY] = useState(machine?.pos_y ?? 10);
  const [posW, setPosW] = useState(machine?.pos_w ?? 25);
  const [posH, setPosH] = useState(machine?.pos_h ?? 25);

  function submit() {
    if (!name.trim() || !code.trim()) return;
    onSave({
      id: machine?.id,
      name,
      code,
      pos_x: Number(posX),
      pos_y: Number(posY),
      pos_w: Number(posW),
      pos_h: Number(posH),
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-slate-800 text-lg mb-4">
          {machine ? "Modifica macchina" : "Nuova macchina"}
        </h3>

        <label className="block text-sm font-medium text-slate-600 mb-1">Nome</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="es. Tornio CNC 1"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        <label className="block text-sm font-medium text-slate-600 mb-1">Codice</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="es. T-001"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        <p className="text-sm font-medium text-slate-600 mb-1">
          Posizione sulla planimetria (% rispetto allo spazio totale)
        </p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">X (orizzontale)</label>
            <input
              type="number"
              value={posX}
              onChange={(e) => setPosX(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Y (verticale)</label>
            <input
              type="number"
              value={posY}
              onChange={(e) => setPosY(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Larghezza</label>
            <input
              type="number"
              value={posW}
              onChange={(e) => setPosW(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Altezza</label>
            <input
              type="number"
              value={posH}
              onChange={(e) => setPosH(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 border border-slate-300 text-slate-600 font-medium py-2.5 rounded-lg hover:bg-slate-50"
          >
            Annulla
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-lg"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskForm({ task, machines, onSave, onCancel, busy }) {
  const [machineId, setMachineId] = useState(task.machine_id || "");
  const [title, setTitle] = useState(task.title || "");
  const [description, setDescription] = useState(task.description || "");
  const [frequency, setFrequency] = useState(task.frequency || "daily");
  const [checklist, setChecklist] = useState(task.checklist || [""]);

  function updateChecklistItem(idx, value) {
    setChecklist((prev) => prev.map((c, i) => (i === idx ? value : c)));
  }
  function addChecklistItem() {
    setChecklist((prev) => [...prev, ""]);
  }
  function removeChecklistItem(idx) {
    setChecklist((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit() {
    if (!title.trim() || !machineId) return;
    onSave({
      id: task.id,
      machine_id: machineId,
      title,
      description,
      frequency,
      checklist,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="font-bold text-slate-800 text-lg mb-4">
          {task.id ? "Modifica attività" : "Nuova attività"}
        </h3>

        <label className="block text-sm font-medium text-slate-600 mb-1">Macchina</label>
        <select
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        <label className="block text-sm font-medium text-slate-600 mb-1">Titolo</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="es. Pulizia generale"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        <label className="block text-sm font-medium text-slate-600 mb-1">Descrizione</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        <label className="block text-sm font-medium text-slate-600 mb-1">Frequenza</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="daily">Giornaliera</option>
          <option value="weekly">Settimanale (ogni lunedì)</option>
          <option value="monthly">Mensile (il giorno 1)</option>
        </select>

        <label className="block text-sm font-medium text-slate-600 mb-1">Checklist</label>
        <div className="space-y-2 mb-3">
          {checklist.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={item}
                onChange={(e) => updateChecklistItem(idx, e.target.value)}
                placeholder={`Punto ${idx + 1}`}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button onClick={() => removeChecklistItem(idx)} className="text-red-500 p-1.5">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={addChecklistItem}
            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Aggiungi punto
          </button>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 border border-slate-300 text-slate-600 font-medium py-2.5 rounded-lg hover:bg-slate-50"
          >
            Annulla
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-lg"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
