import { LanguageContext, Text } from "./src/i18n";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import {
  balance,
  Customer,
  Data,
  demoData,
  Entry,
  initialData,
  money,
  monthly,
  today,
  uid,
  validBackup,
} from "./src/model";
import {
  Button,
  Card,
  Chips,
  colors,
  Empty,
  Field,
  Hint,
  Icon,
  Row,
  s,
  Title,
  Toggle,
} from "./src/ui";

type Screen =
  | "welcome"
  | "login"
  | "otp"
  | "setup"
  | "home"
  | "customers"
  | "customerForm"
  | "customer"
  | "credit"
  | "payment"
  | "transaction"
  | "editTransaction"
  | "khata"
  | "statement"
  | "share"
  | "notifications"
  | "reports"
  | "more"
  | "profile"
  | "settings"
  | "reminders"
  | "help"
  | "subscription"
  | "account"
  | "audit";
type Route = { screen: Screen; id?: string };
const STORAGE = "digital-khata-v1";
const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const phoneValid = (value: string) => /^[6-9]\d{9}$/.test(value);
const titles: Partial<Record<Screen, string>> = {
  login: "Login",
  otp: "Verify Mobile",
  setup: "Set Up Your Shop",
  customers: "Customers",
  customerForm: "Add Customer",
  credit: "Add Udhari",
  payment: "Record Payment",
  transaction: "Transaction",
  editTransaction: "Edit Transaction",
  khata: "Khata",
  statement: "Monthly Statement",
  share: "Share Statement",
  notifications: "Notifications",
  reports: "Reports",
  more: "More",
  profile: "Shop Profile",
  settings: "Settings",
  reminders: "Reminder Settings",
  help: "Help & Support",
  subscription: "Choose Your Plan",
  account: "Account",
  audit: "Activity History",
};
function AppContent() {
  const [data, setData] = useState<Data>(initialData);
  const dataRef = useRef(data);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const writeQueue = useRef<Promise<boolean>>(Promise.resolve(true));
  const [route, setRoute] = useState<Route>({ screen: "welcome" });
  const [history, setHistory] = useState<Route[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [form, setForm] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [faq, setFaq] = useState("");
  const [channel, setChannel] = useState("WhatsApp");
  const [plan, setPlan] = useState("Pro");
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!validBackup(parsed)) throw new Error("Invalid stored data");
          if (live) {
            setData(parsed);
            dataRef.current = parsed;
            setRoute({
              screen: parsed.signedIn
                ? parsed.shop.name
                  ? "home"
                  : "setup"
                : "welcome",
            });
          }
        }
      } catch {
        if (live) setLoadError(true);
        Alert.alert(
          "Could not load your khata",
          "Stored data could not be read. Please restart the app before adding new records.",
        );
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (route.screen !== "otp" || seconds <= 0) return;
    const t = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(t);
  }, [route.screen, seconds]);
  const back = () => {
    if (history.length) {
      setRoute(history[history.length - 1]);
      setHistory(history.slice(0, -1));
      setSearch("");
      setFilter("All");
    } else if (data.signedIn && route.screen !== "home" && data.shop.name) {
      setRoute({ screen: "home" });
    } else return false;
    return true;
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", back);
    return () => sub.remove();
  }, [history, route, data.signedIn]);
  function commit(next: Data): Promise<boolean> {
    if (loadError) return Promise.resolve(false);
    dataRef.current = next;
    const operation = writeQueue.current.then(async () => {
      try {
        await AsyncStorage.setItem(STORAGE, JSON.stringify(next));
        setData(next);
        return true;
      } catch {
        setLoadError(true);
        Alert.alert(
          "Unable to save",
          "Your change was not saved. Restart the app and check available storage before continuing.",
        );
        return false;
      }
    });
    writeQueue.current = operation;
    return operation;
  }
  async function save(next: Data, done: () => void) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (await commit(next)) done();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function go(screen: Screen, id?: string, reset = false) {
    setHistory(reset ? [] : [...history, route]);
    setRoute({ screen, id });
    setSearch("");
    setFilter("All");
    setFaq("");
    if (screen === "customerForm") {
      const c = data.customers.find((x) => x.id === id);
      setForm(
        c
          ? {
              name: c.name,
              phone: c.phone,
              address: c.address,
              opening: String(c.opening),
              limit: String(c.limit),
              reminder: String(c.reminder),
            }
          : {
              name: "",
              phone: "",
              address: "",
              opening: "0",
              limit: "10000",
              reminder: "true",
            },
      );
    }
    if (
      screen === "credit" ||
      screen === "payment" ||
      screen === "editTransaction"
    ) {
      const e =
        screen === "editTransaction"
          ? data.entries.find((x) => x.id === id)
          : undefined;
      setForm({
        customerId: e?.customerId || id || data.customers[0]?.id || "",
        amount: e ? String(e.amount) : "",
        date: e?.date || today(),
        note: e?.note || "",
        method: e?.method || data.defaultMethod,
        due: e?.due || "",
      });
    }
    if (screen === "setup") setForm({ ...data.shop });
    if (screen === "share" && id) setForm({ message: statementText(id) });
  }
  const f = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const field = (
    label: string,
    key: string,
    extra: Record<string, unknown> = {},
  ) => (
    <Field
      label={label}
      value={form[key] || ""}
      onChangeText={(v) => f(key, v)}
      {...extra}
    />
  );
  const customer = data.customers.find((c) => c.id === route.id);
  const entry = data.entries.find((e) => e.id === route.id);
  const outstanding = data.customers.reduce(
    (sum, c) => sum + Math.max(0, balance(data, c.id)),
    0,
  );
  const monthEntries = data.entries.filter((e) => e.date.startsWith(month));
  const totalCredit = monthEntries
    .filter((e) => e.type === "credit")
    .reduce((s, e) => s + e.amount, 0);
  const totalPayment = monthEntries
    .filter((e) => e.type === "payment")
    .reduce((s, e) => s + e.amount, 0);
  const isOverdue = (c: Customer) =>
    balance(data, c.id) > 0 &&
    data.entries.some(
      (e) =>
        e.customerId === c.id &&
        e.type === "credit" &&
        e.due &&
        e.due < today(),
    );
  function statementText(id: string) {
    const c = data.customers.find((c) => c.id === id);
    const m = monthly(data, id, month);
    return `Hello ${c?.name},\nYour ${monthLabel(month)} khata from ${data.shop.name}:\n\nOpening: ${money(m.opening)}\nUdhari: ${money(m.credit)}\nPayment: ${money(m.payment)}\nOutstanding: ${money(m.closing)}\n\nThank you!`;
  }
  function changeMonth(delta: number) {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth() + delta);
    setMonth(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    );
  }
  const monthPicker = (
    <View
      style={[
        s.split,
        { justifyContent: "space-between", alignItems: "center" },
      ]}
    >
      <Pressable
        accessibilityLabel="Previous month"
        onPress={() => changeMonth(-1)}
        style={{ padding: 10 }}
      >
        <Icon name="chevron-back" />
      </Pressable>
      <Text style={s.rowTitle}>{monthLabel(month)}</Text>
      <Pressable
        accessibilityLabel="Next month"
        onPress={() => changeMonth(1)}
        style={{ padding: 10 }}
      >
        <Icon name="chevron-forward" />
      </Pressable>
    </View>
  );
  const stat = (label: string, value: string, pale = false) => (
    <Card style={{ flex: 1, backgroundColor: pale ? colors.pale : "white" }}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.stat}>{value}</Text>
    </Card>
  );
  const actions = (id?: string) => (
    <View style={s.split}>
      <View style={{ flex: 1 }}>
        <Button title="+ Add Udhari" onPress={() => go("credit", id)} />
      </View>
      <View style={{ flex: 1 }}>
        <Button title="₹ Payment" orange onPress={() => go("payment", id)} />
      </View>
    </View>
  );
  const customerRow = (c: Customer) => (
    <Pressable
      key={c.id}
      onPress={() => go("customer", c.id)}
      accessibilityRole="button"
    >
      <Card>
        <View style={[s.split, { alignItems: "center" }]}>
          <View style={s.avatar}>
            <Text style={{ color: colors.green, fontWeight: "700" }}>
              {c.name[0]?.toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{c.name}</Text>
            <Text style={s.small}>
              {isOverdue(c) ? "Overdue • " : ""}
              {c.phone || "No phone added"}
            </Text>
          </View>
          <Text style={{ color: colors.green, fontWeight: "700" }}>
            {money(balance(data, c.id))}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
  const entryRow = (e: Entry) => (
    <Pressable
      key={e.id}
      accessibilityRole="button"
      onPress={() => go("transaction", e.id)}
    >
      <Card>
        <View style={[s.split, { alignItems: "center" }]}>
          <View style={s.avatar}>
            <Icon
              name={
                e.type === "credit"
                  ? "bag-handle-outline"
                  : "arrow-down-outline"
              }
              size={20}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>
              {data.customers.find((c) => c.id === e.customerId)?.name}
            </Text>
            <Text style={s.small}>
              {e.type === "credit" ? "Udhari" : "Payment"} • {e.date}
            </Text>
          </View>
          <Text
            style={{
              fontWeight: "700",
              color: e.type === "credit" ? colors.green : colors.orange,
            }}
          >
            {e.type === "credit" ? "+" : "−"}
            {money(e.amount)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
  function saveCustomer() {
    const name = form.name?.trim();
    const opening = Number(form.opening || 0),
      limit = Number(form.limit || 0);
    if (!name)
      return Alert.alert("Name required", "Enter the customer’s name.");
    if (form.phone && !phoneValid(form.phone))
      return Alert.alert(
        "Invalid phone",
        "Enter a valid 10-digit Indian mobile number.",
      );
    if (
      !Number.isFinite(opening) ||
      opening < 0 ||
      opening > 1e9 ||
      !Number.isFinite(limit) ||
      limit < 0 ||
      limit > 1e9
    )
      return Alert.alert(
        "Invalid balance",
        "Opening balance and credit limit must be between ₹0 and ₹100 crore.",
      );
    const c: Customer = {
      id: route.id || uid(),
      name,
      phone: form.phone.trim(),
      address: form.address.trim(),
      opening: Math.round(opening * 100) / 100,
      limit: Math.round(limit * 100) / 100,
      reminder: form.reminder === "true",
    };
    save(
      {
        ...data,
        customers: route.id
          ? data.customers.map((x) => (x.id === route.id ? c : x))
          : [...data.customers, c],
        audit: [
          {
            id: uid(),
            action: `${route.id ? "Updated" : "Added"} customer: ${name}`,
            date: new Date().toISOString(),
          },
          ...data.audit,
        ],
      },
      () => go("customer", c.id, true),
    );
  }
  function saveEntry() {
    const old = route.screen === "editTransaction" ? entry : undefined;
    const type =
      old?.type || (route.screen === "payment" ? "payment" : "credit");
    const amount = Number(form.amount);
    const c = data.customers.find((c) => c.id === form.customerId);
    if (!c)
      return Alert.alert(
        "Select a customer",
        "Add a customer before recording a transaction.",
      );
    if (
      !Number.isFinite(amount) ||
      amount < 0.01 ||
      amount > 1e9 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
    )
      return Alert.alert(
        "Invalid amount",
        "Enter an amount from ₹0.01 to ₹100 crore, with no more than two decimal places.",
      );
    if (!validDate(form.date) || (form.due && !validDate(form.due)))
      return Alert.alert(
        "Invalid date",
        "Use a valid date in YYYY-MM-DD format.",
      );
    if (form.due && form.due < form.date)
      return Alert.alert(
        "Invalid due date",
        "Due date cannot be before the transaction date.",
      );
    const e: Entry = {
      id: old?.id || uid(),
      customerId: c.id,
      type,
      amount: Math.round(amount * 100) / 100,
      date: form.date,
      note: form.note.trim(),
      method: form.method,
      due: type === "credit" ? form.due : "",
    };
    const next = {
      ...data,
      entries: old
        ? data.entries.map((x) => (x.id === old.id ? e : x))
        : [e, ...data.entries],
      audit: [
        {
          id: uid(),
          action: old
            ? "Edited transaction"
            : `Recorded ${type === "credit" ? "udhari" : "payment"}`,
          date: new Date().toISOString(),
          ...(old ? { before: old } : {}),
          after: e,
        },
        ...data.audit,
      ],
    };
    const apply = () => save(next, () => go("customer", c.id, true));
    if (type === "credit" && c.limit > 0 && balance(next, c.id) > c.limit)
      Alert.alert(
        "Credit limit exceeded",
        `This takes ${c.name} above their ${money(c.limit)} credit limit.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Save anyway", onPress: apply },
        ],
      );
    else apply();
  }
  function deleteEntry(e: Entry) {
    Alert.alert(
      "Delete transaction?",
      `Remove this ${money(e.amount)} entry? The change will remain in Activity History.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            save(
              {
                ...data,
                entries: data.entries.filter((x) => x.id !== e.id),
                audit: [
                  {
                    id: uid(),
                    action: "Deleted transaction",
                    date: new Date().toISOString(),
                    before: e,
                  },
                  ...data.audit,
                ],
              },
              () => go("customer", e.customerId, true),
            ),
        },
      ],
    );
  }
  async function exportData(backup: boolean) {
    try {
      const quote = (x: unknown) => {
        const raw = String(x);
        const safe =
          typeof x === "string" && /^[=+@\-\t\r]/.test(raw) ? "'" + raw : raw;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const csv = [
        "Customer,Type,Amount,Date,Description,Method",
        ...data.customers
          .filter((c) => c.opening !== 0)
          .map((c) =>
            [c.name, "opening", c.opening, "", "Opening balance", ""]
              .map(quote)
              .join(","),
          ),
        ...data.entries.map((e) =>
          [
            data.customers.find((c) => c.id === e.customerId)?.name,
            e.type,
            e.amount,
            e.date,
            e.note,
            e.method,
          ]
            .map(quote)
            .join(","),
        ),
      ].join("\n");
      const file = new File(
        Paths.cache,
        backup ? "digital-khata-backup.json" : "digital-khata-ledger.csv",
      );
      file.write(backup ? JSON.stringify(data, null, 2) : csv);
      await Sharing.shareAsync(file.uri, {
        mimeType: backup ? "application/json" : "text/csv",
        dialogTitle: backup ? "Save your khata backup" : "Export ledger",
      });
    } catch {
      Alert.alert("Export failed", "Please try again.");
    }
  }
  async function deleteLocalAccount() {
    try {
      for (const name of [
        "digital-khata-backup.json",
        "digital-khata-ledger.csv",
      ]) {
        const file = new File(Paths.cache, name);
        if (file.exists) file.delete();
      }
      await save(initialData, () => {
        setPhone("");
        setOtp("");
        setForm({});
        go("welcome", undefined, true);
      });
    } catch {
      Alert.alert(
        "Unable to delete",
        "Could not remove cached exports. Please restart the app and try again.",
      );
    }
  }
  async function restore() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const parsed = JSON.parse(await new File(result.assets[0].uri).text());
      if (!validBackup(parsed))
        return Alert.alert(
          "Invalid backup",
          "This file is not a valid Digital Khata backup.",
        );
      Alert.alert(
        "Replace local data?",
        `Restore ${parsed.customers.length} customers and ${parsed.entries.length} transactions? Current local records will be replaced.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Restore",
            onPress: () =>
              save({ ...parsed, signedIn: true }, () =>
                go("home", undefined, true),
              ),
          },
        ],
      );
    } catch {
      Alert.alert(
        "Restore failed",
        "Select a valid Digital Khata JSON backup.",
      );
    }
  }
  async function sendStatement() {
    if (!customer?.phone)
      return Alert.alert(
        "Phone number required",
        "Edit the customer and add a valid mobile number first.",
      );
    if (!customer.reminder)
      return Alert.alert(
        "Customer opted out",
        "This customer has disabled WhatsApp/SMS reminders.",
      );
    try {
      const message = encodeURIComponent(form.message);
      await Linking.openURL(
        channel === "WhatsApp"
          ? `https://wa.me/91${customer.phone}?text=${message}`
          : `sms:+91${customer.phone}?body=${message}`,
      );
    } catch {
      Alert.alert("Unable to open app", `Please install or enable ${channel}.`);
    }
  }
  let content: React.ReactNode = null;
  switch (route.screen) {
    case "welcome":
      content = (
        <>
          <View style={{ paddingTop: 32 }}>
            <View style={s.logo}>
              <Text style={{ fontSize: 49, color: "white", fontWeight: "700" }}>
                ₹
              </Text>
            </View>
            <Text style={[s.hero, { textAlign: "center" }]}>
              Welcome to{"\n"}
              <Text style={{ color: colors.green }}>Digital Khata</Text>
            </Text>
            <Text
              style={[
                s.hint,
                { textAlign: "center", marginTop: 15, fontSize: 16 },
              ]}
            >
              Manage customer udhari and payments{"\n"}without the paper
              notebook.
            </Text>
          </View>
          <Card
            style={{
              backgroundColor: colors.pale,
              alignItems: "center",
              padding: 28,
              marginVertical: 15,
            }}
          >
            <Icon name="storefront-outline" size={54} />
            <Title>Simple digital khata</Title>
            <Hint>Udhari ka hisaab, ab aur bhi aasan</Hint>
          </Card>
          <Chips
            items={["English", "हिन्दी"]}
            value={data.language}
            onChange={(language) => commit({ ...data, language })}
          />
          <Button title="Login" onPress={() => go("login")} />
          <Button
            title="Create Account"
            secondary
            onPress={() => go("login")}
          />
          <Button
            title="Explore demo shop"
            secondary
            onPress={() => {
              if (data.shop.name || data.customers.length) {
                Alert.alert(
                  "A shop already exists",
                  "Log in to your existing shop. Export a backup and delete the local account before loading new demo data.",
                );
                return;
              }
              save({ ...demoData(), language: data.language }, () =>
                go("home", undefined, true),
              );
            }}
          />
          <Hint>
            Demo mode • Data is stored on this device. No real OTP or cloud
            account is created.
          </Hint>
        </>
      );
      break;
    case "login":
      content = (
        <>
          <Title>Enter your mobile number</Title>
          <Hint>Keep your shop’s khata close, wherever you go.</Hint>
          <Field
            label="Mobile number (+91)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            maxLength={10}
            placeholder="98XXXXXXXX"
          />
          <Button
            title="Continue"
            onPress={() => {
              if (!phoneValid(phone))
                return Alert.alert(
                  "Invalid mobile number",
                  "Enter a valid 10-digit Indian mobile number.",
                );
              setOtp("");
              setSeconds(30);
              go("otp");
            }}
          />
          <Card>
            <Hint>
              Local demo login: use verification code 123456. SMS verification
              requires a connected authentication service.
            </Hint>
          </Card>
        </>
      );
      break;
    case "otp":
      content = (
        <>
          <Title>Enter OTP</Title>
          <Hint>Demo verification for +91 {phone}</Hint>
          <Field
            label="6-digit verification code"
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={setOtp}
            placeholder="• • • • • •"
          />
          <Pressable
            disabled={seconds > 0}
            onPress={() => {
              setSeconds(30);
              Alert.alert("Demo code", "Use 123456. No SMS was sent.");
            }}
          >
            <Text style={s.link}>
              {seconds
                ? `Resend OTP in 00:${String(seconds).padStart(2, "0")}`
                : "Resend OTP"}
            </Text>
          </Pressable>
          <Button
            title="Verify"
            disabled={busy}
            onPress={() => {
              if (otp !== "123456")
                return Alert.alert(
                  "Incorrect code",
                  "Use 123456 for the local demo.",
                );
              if (data.shop.phone && data.shop.phone !== phone)
                return Alert.alert(
                  "Different shop number",
                  "This device already has a shop. Use its mobile number or delete the local account before setting up another shop.",
                );
              save(
                { ...data, signedIn: true, shop: { ...data.shop, phone } },
                () => {
                  if (data.shop.name) go("home", undefined, true);
                  else {
                    setRoute({ screen: "setup" });
                    setHistory([]);
                    setForm({ ...data.shop, phone });
                  }
                },
              );
            }}
          />
          <Button
            title="Change mobile number"
            secondary
            onPress={() => go("login")}
          />
        </>
      );
      break;
    case "setup":
      content = (
        <>
          {field("Shop Name *", "name", {
            placeholder: "Sharma General Store",
          })}
          {field("Owner Name *", "owner", { placeholder: "Rajesh Sharma" })}
          {field("Address", "address", { placeholder: "Delhi" })}
          {field("WhatsApp number (optional)", "whatsapp", {
            keyboardType: "phone-pad",
            maxLength: 10,
            placeholder: "98XXXXXXXX",
          })}
          <Title>Language</Title>
          <Chips
            items={["English", "हिन्दी"]}
            value={data.language}
            onChange={(language) => commit({ ...data, language })}
          />
          <Button
            title={data.shop.name ? "Save Profile" : "Start Using Khata"}
            disabled={busy}
            onPress={() => {
              if (!form.name?.trim() || !form.owner?.trim())
                return Alert.alert(
                  "Required fields",
                  "Enter the shop and owner names.",
                );
              if (form.whatsapp && !phoneValid(form.whatsapp))
                return Alert.alert(
                  "Invalid WhatsApp number",
                  "Enter a valid 10-digit mobile number.",
                );
              save(
                {
                  ...data,
                  shop: {
                    name: form.name.trim(),
                    owner: form.owner.trim(),
                    address: form.address || "",
                    phone: data.shop.phone,
                    whatsapp: form.whatsapp || "",
                  },
                },
                () => go("home", undefined, true),
              );
            }}
          />
        </>
      );
      break;
    case "home":
      content = (
        <>
          <View style={[s.split, { alignItems: "center" }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.heading, { fontSize: 23 }]}>
                Good{" "}
                {new Date().getHours() < 12
                  ? "Morning"
                  : new Date().getHours() < 17
                    ? "Afternoon"
                    : "Evening"}
                , {data.shop.owner.split(" ")[0]} 👋
              </Text>
              <Hint>{data.shop.name}</Hint>
            </View>
            <Pressable
              accessibilityLabel="Notifications"
              onPress={() => go("notifications")}
            >
              <Icon name="notifications-outline" />
            </Pressable>
          </View>
          <View style={s.split}>
            {stat("Total Outstanding", money(outstanding), true)}
            {stat("Customers", String(data.customers.length))}
          </View>
          {actions()}
          <View style={s.split}>
            {stat(
              "This month’s udhari",
              money(
                data.entries
                  .filter(
                    (e) =>
                      e.date.startsWith(today().slice(0, 7)) &&
                      e.type === "credit",
                  )
                  .reduce((s, e) => s + e.amount, 0),
              ),
            )}
            {stat(
              "This month’s collection",
              money(
                data.entries
                  .filter(
                    (e) =>
                      e.date.startsWith(today().slice(0, 7)) &&
                      e.type === "payment",
                  )
                  .reduce((s, e) => s + e.amount, 0),
              ),
            )}
          </View>
          <Title>Recent Transactions</Title>
          {data.entries.length ? (
            data.entries
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 4)
              .map(entryRow)
          ) : (
            <Empty
              title="Your khata starts here"
              description="Add your first customer, then record udhari or a payment."
            />
          )}
          <Title>Customers With Pending Balance</Title>
          {data.customers
            .filter((c) => balance(data, c.id) > 0)
            .slice(0, 4)
            .map(customerRow)}
          <Button
            title="+ Add Customer"
            secondary
            onPress={() => go("customerForm")}
          />
        </>
      );
      break;
    case "customers": {
      const list = data.customers.filter(
        (c) =>
          (c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.phone.includes(search)) &&
          (filter === "All" ||
            (filter === "Due" && balance(data, c.id) > 0) ||
            (filter === "Paid" && balance(data, c.id) <= 0) ||
            (filter === "Overdue" && isOverdue(c))),
      );
      content = (
        <>
          <Field
            label="Search customers"
            placeholder="Search name or phone"
            value={search}
            onChangeText={setSearch}
          />
          <Chips
            items={["All", "Due", "Paid", "Overdue"]}
            value={filter}
            onChange={setFilter}
          />
          {list.map(customerRow)}
          {!list.length && (
            <Empty
              title="No customers found"
              description="Add a customer or try a different search."
            />
          )}
          <Button title="+ Add Customer" onPress={() => go("customerForm")} />
        </>
      );
      break;
    }
    case "customerForm":
      content = (
        <>
          {field("Name *", "name", { placeholder: "Rahul Kumar" })}
          {field("Phone Number", "phone", {
            keyboardType: "phone-pad",
            maxLength: 10,
            placeholder: "98XXXXXXXX",
          })}
          {field("Address", "address", { placeholder: "Delhi" })}
          {field("Opening Balance (₹)", "opening", {
            keyboardType: "decimal-pad",
            editable: !route.id,
          })}
          {route.id && (
            <Hint>
              Opening balance is fixed after creation. Use ledger entries to
              record subsequent changes.
            </Hint>
          )}
          {field("Credit Limit (₹, 0 = no limit)", "limit", {
            keyboardType: "decimal-pad",
          })}
          <Toggle
            label="WhatsApp / SMS reminders"
            value={form.reminder === "true"}
            onChange={(v) => f("reminder", String(v))}
          />
          <Button
            title="Save Customer"
            disabled={busy}
            onPress={saveCustomer}
          />
        </>
      );
      break;
    case "customer":
      if (customer) {
        const entries = data.entries.filter(
          (e) => e.customerId === customer.id,
        );
        content = (
          <>
            <Hint>
              {customer.phone || "No phone number"} •{" "}
              {customer.address || "No address"}
            </Hint>
            <Card style={{ backgroundColor: colors.pale }}>
              <Hint>Current Outstanding</Hint>
              <Text style={s.amount}>{money(balance(data, customer.id))}</Text>
            </Card>
            {actions(customer.id)}
            <View style={s.split}>
              {stat(
                "Total Udhari",
                money(
                  entries
                    .filter((e) => e.type === "credit")
                    .reduce((s, e) => s + e.amount, 0),
                ),
              )}
              {stat(
                "Total Payments",
                money(
                  entries
                    .filter((e) => e.type === "payment")
                    .reduce((s, e) => s + e.amount, 0),
                ),
              )}
            </View>
            <View style={s.split}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Statement"
                  secondary
                  onPress={() => go("statement", customer.id)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Edit Customer"
                  secondary
                  onPress={() => go("customerForm", customer.id)}
                />
              </View>
            </View>
            <Title>Transaction History</Title>
            {entries
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map(entryRow)}
            {!entries.length && (
              <Empty
                title="No transactions yet"
                description="Opening balance is included in the outstanding amount."
              />
            )}
          </>
        );
      }
      break;
    case "credit":
    case "payment":
    case "editTransaction":
      content = (
        <>
          {route.screen !== "editTransaction" && (
            <>
              <Title>Customer</Title>
              <Field
                label="Find a customer"
                value={search}
                onChangeText={setSearch}
                placeholder="Search name or phone"
              />
              <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                {data.customers
                  .filter(
                    (c) =>
                      c.name.toLowerCase().includes(search.toLowerCase()) ||
                      c.phone.includes(search),
                  )
                  .map((c) => (
                    <Row
                      key={c.id}
                      title={c.name}
                      value={form.customerId === c.id ? "✓" : ""}
                      onPress={() => f("customerId", c.id)}
                    />
                  ))}
              </ScrollView>
            </>
          )}
          {!data.customers.length ? (
            <Button title="+ Add Customer" onPress={() => go("customerForm")} />
          ) : (
            <>
              {field("Amount (₹) *", "amount", {
                keyboardType: "decimal-pad",
                placeholder: "0",
                style: [
                  s.input,
                  {
                    backgroundColor: colors.pale,
                    color: colors.green,
                    fontSize: 32,
                    fontWeight: "800",
                    textAlign: "center",
                    height: 80,
                  },
                ],
              })}
              {field("Date (YYYY-MM-DD) *", "date", {
                placeholder: "2026-10-13",
              })}
              {route.screen === "credit" || entry?.type === "credit" ? (
                field("Due date (optional, YYYY-MM-DD)", "due", {
                  placeholder: "YYYY-MM-DD",
                })
              ) : (
                <>
                  <Title>Payment Method</Title>
                  <Chips
                    items={["Cash", "UPI", "Bank", "Other"]}
                    value={form.method}
                    onChange={(v) => f("method", v)}
                  />
                </>
              )}
              {field("Description / Note", "note", {
                placeholder:
                  route.screen === "credit"
                    ? "Grocery Items"
                    : "Received payment",
                multiline: true,
              })}
              <Button
                title={
                  route.screen === "editTransaction"
                    ? "Save Changes"
                    : route.screen === "credit"
                      ? "Save Udhari"
                      : "Save Payment"
                }
                disabled={busy}
                onPress={saveEntry}
              />
              {route.screen === "editTransaction" && entry && (
                <Button
                  title="Delete Transaction"
                  danger
                  onPress={() => deleteEntry(entry)}
                />
              )}
            </>
          )}
        </>
      );
      break;
    case "transaction":
      if (entry) {
        content = (
          <>
            <Card style={{ alignItems: "center", paddingVertical: 30 }}>
              <Text style={s.amount}>{money(entry.amount)}</Text>
              <View style={s.badge}>
                <Text style={{ color: colors.green, fontWeight: "700" }}>
                  {entry.type === "credit" ? "UDHARI" : "PAYMENT"}
                </Text>
              </View>
              <Title>
                {data.customers.find((c) => c.id === entry.customerId)?.name}
              </Title>
              <Hint>{entry.date}</Hint>
            </Card>
            <Title>Description</Title>
            <Text style={s.rowTitle}>{entry.note || "No description"}</Text>
            {entry.type === "payment" && (
              <Row title="Payment Method" value={entry.method} />
            )}
            {entry.due && <Row title="Due Date" value={entry.due} />}
            <Button
              title="Edit"
              onPress={() => go("editTransaction", entry.id)}
            />
            <Button title="Delete" danger onPress={() => deleteEntry(entry)} />
          </>
        );
      }
      break;
    case "khata":
      content = (
        <>
          {monthPicker}
          <Field
            label="Search customer"
            value={search}
            onChangeText={setSearch}
            placeholder="Customer name"
          />
          <Chips
            items={["All", "Udhari", "Payment"]}
            value={filter}
            onChange={setFilter}
          />
          {data.customers
            .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
            .filter(
              (c) =>
                filter === "All" ||
                monthly(data, c.id, month)[
                  filter === "Udhari" ? "credit" : "payment"
                ] > 0,
            )
            .map((c) => {
              const m = monthly(data, c.id, month);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={c.id}
                  onPress={() => go("statement", c.id)}
                >
                  <Card>
                    <Title>{c.name}</Title>
                    <Row title="Opening" value={money(m.opening)} />
                    <Row title="Udhari" value={money(m.credit)} />
                    <Row title="Payment" value={money(m.payment)} />
                    <Row
                      title="Closing Balance"
                      value={money(m.closing)}
                      color={colors.green}
                    />
                  </Card>
                </Pressable>
              );
            })}
          {!data.customers.length && (
            <Empty
              title="Your monthly khata"
              description="Customer balances will appear here after you add customers."
            />
          )}
        </>
      );
      break;
    case "statement":
      if (customer) {
        const m = monthly(data, customer.id, month);
        content = (
          <>
            {monthPicker}
            <Card>
              <Title>{data.shop.name}</Title>
              <Hint>{data.shop.address}</Hint>
              <Text style={s.rowTitle}>{customer.name}</Text>
              <Row title="Opening Balance" value={money(m.opening)} />
              {m.entries.map((e) => (
                <Row
                  key={e.id}
                  title={e.note || (e.type === "credit" ? "Udhari" : "Payment")}
                  subtitle={e.date}
                  value={`${e.type === "credit" ? "+" : "−"}${money(e.amount)}`}
                  onPress={() => go("transaction", e.id)}
                />
              ))}
              <Row title="Total Udhari" value={money(m.credit)} />
              <Row title="Total Payment" value={money(m.payment)} />
              <Hint>Outstanding</Hint>
              <Text style={s.amount}>{money(m.closing)}</Text>
            </Card>
            <Button
              title="WhatsApp / SMS Share"
              onPress={() => go("share", customer.id)}
            />
            <Button
              title="Share Statement"
              secondary
              onPress={() => {
                Share.share({ message: statementText(customer.id) }).catch(() =>
                  Alert.alert("Unable to share", "Please try again."),
                );
              }}
            />
          </>
        );
      }
      break;
    case "share":
      if (customer)
        content = (
          <>
            <Title>
              {customer.name} • {monthLabel(month)}
            </Title>
            <Card style={{ backgroundColor: colors.pale }}>
              <Hint>Outstanding</Hint>
              <Text style={s.amount}>
                {money(monthly(data, customer.id, month).closing)}
              </Text>
            </Card>
            <Title>Send Via</Title>
            <Chips
              items={["WhatsApp", "SMS"]}
              value={channel}
              onChange={setChannel}
            />
            {field("Message Preview", "message", {
              multiline: true,
              style: [s.input, { height: 240, textAlignVertical: "top" }],
            })}
            <Button title={`Open ${channel}`} onPress={sendStatement} />
            <Hint>You can review and send the message in {channel}.</Hint>
          </>
        );
      break;
    case "notifications":
      content = (
        <>
          <Hint>Local activity and monthly statements</Hint>
          {data.audit.length === 0 && (
            <Empty
              title="You’re all caught up"
              description="New customers and transaction confirmations appear here."
            />
          )}
          {data.audit.slice(0, 30).map((a) => (
            <Card
              key={a.id}
              style={{
                backgroundColor: data.read.includes(a.id)
                  ? "white"
                  : colors.pale,
              }}
            >
              <Row
                title={a.action}
                subtitle={new Date(a.date).toLocaleString("en-IN")}
                value={data.read.includes(a.id) ? "Read" : "New"}
                onPress={() => {
                  commit({ ...data, read: [...new Set([...data.read, a.id])] });
                }}
              />
            </Card>
          ))}
          {outstanding > 0 && (
            <Row
              title="Monthly statements available"
              subtitle="Review pending balances in Khata"
              onPress={() => go("khata")}
            />
          )}
        </>
      );
      break;
    case "reports": {
      const trend = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(`${month}-01T12:00:00`);
        d.setMonth(d.getMonth() - 5 + i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return {
          label: d.toLocaleDateString("en-IN", { month: "short" }),
          value: data.entries
            .filter((e) => e.type === "credit" && e.date.startsWith(key))
            .reduce((s, e) => s + e.amount, 0),
        };
      });
      const max = Math.max(...trend.map((t) => t.value), 1);
      content = (
        <>
          {monthPicker}
          <View style={s.split}>
            {stat("Monthly Udhari", money(totalCredit), true)}
            {stat("Collection", money(totalPayment))}
          </View>
          <View style={s.split}>
            {stat("Outstanding (all time)", money(outstanding))}
            {stat(
              "Active customers",
              String(new Set(monthEntries.map((e) => e.customerId)).size),
            )}
          </View>
          <Card>
            <Title>6-Month Udhari Trend</Title>
            <View
              style={{
                height: 180,
                flexDirection: "row",
                gap: 12,
                alignItems: "flex-end",
                paddingTop: 20,
              }}
            >
              {trend.map((t, i) => (
                <View key={i} style={{ flex: 1, alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 9, color: colors.muted }}>
                    {money(t.value)}
                  </Text>
                  <View
                    style={{
                      height: Math.max(3, (t.value / max) * 115),
                      backgroundColor: colors.green,
                      width: "75%",
                      borderTopLeftRadius: 5,
                      borderTopRightRadius: 5,
                    }}
                  />
                  <Text style={s.small}>{t.label}</Text>
                </View>
              ))}
            </View>
          </Card>
          <Card>
            <Title>Customer Balance Distribution</Title>
            <Row
              title="Paid / Credit balance"
              value={String(
                data.customers.filter((c) => balance(data, c.id) <= 0).length,
              )}
            />
            <Row
              title="Pending"
              value={String(
                data.customers.filter(
                  (c) => balance(data, c.id) > 0 && !isOverdue(c),
                ).length,
              )}
            />
            <Row
              title="Overdue"
              value={String(data.customers.filter(isOverdue).length)}
            />
          </Card>
        </>
      );
      break;
    }
    case "more":
      content = (
        <>
          <Card style={{ backgroundColor: colors.pale }}>
            <Icon name="storefront-outline" size={32} />
            <Title>{data.shop.name}</Title>
            <Hint>{data.shop.owner}</Hint>
          </Card>
          {(
            [
              "profile",
              "reports",
              "notifications",
              "settings",
              "help",
              "subscription",
              "audit",
              "account",
            ] as Screen[]
          ).map((screen) => (
            <Row
              key={screen}
              title={titles[screen] || screen}
              onPress={() => go(screen)}
            />
          ))}
          <Hint>Digital Khata 1.0 • Local demo</Hint>
        </>
      );
      break;
    case "profile":
      content = (
        <>
          <View style={s.logo}>
            <Text style={{ color: "white", fontSize: 40, fontWeight: "800" }}>
              {data.shop.name[0]}
            </Text>
          </View>
          <Text style={[s.heading, { textAlign: "center" }]}>
            {data.shop.name}
          </Text>
          <Row title="Owner" value={data.shop.owner} />
          <Row title="Phone" value={data.shop.phone} />
          <Row title="WhatsApp" value={data.shop.whatsapp || "Not added"} />
          <Row title="Address" value={data.shop.address || "Not added"} />
          <Button title="Edit Profile" onPress={() => go("setup")} />
        </>
      );
      break;
    case "settings":
      content = (
        <>
          <Title>ACCOUNT</Title>
          <Row title="Mobile Number" value={data.shop.phone} />
          <Row
            title="Change PIN"
            onPress={() =>
              Alert.alert(
                "PIN authentication not configured",
                "Connect an authentication service before enabling PIN changes and recovery.",
              )
            }
          />
          <Row title="Logout / Account actions" onPress={() => go("account")} />
          <Hint>
            PIN and real account authentication require a backend integration.
          </Hint>
          <Title>KHATA</Title>
          <Row title="Reminder Settings" onPress={() => go("reminders")} />
          <Title>Default payment method</Title>
          <Chips
            items={["Cash", "UPI", "Bank", "Other"]}
            value={data.defaultMethod}
            onChange={(v) => commit({ ...data, defaultMethod: v })}
          />
          <Title>DATA</Title>
          <Row title="Export data (CSV)" onPress={() => exportData(false)} />
          <Row title="Save backup (JSON)" onPress={() => exportData(true)} />
          <Row title="Restore backup" onPress={restore} />
          <Title>LANGUAGE</Title>
          <Chips
            items={["English", "हिन्दी"]}
            value={data.language}
            onChange={(language) => commit({ ...data, language })}
          />
          <Hint>All data stays on this device; save regular backups.</Hint>
        </>
      );
      break;
    case "reminders": {
      const r = data.reminders;
      const update = (key: string, value: string | boolean) =>
        commit({
          ...dataRef.current,
          reminders: { ...dataRef.current.reminders, [key]: value },
        });
      content = (
        <>
          <Hint>
            Reminder preferences are saved locally. Automatic delivery requires
            a backend; share statements manually from Khata.
          </Hint>
          <Toggle
            label="Monthly Reminder"
            value={r.enabled}
            onChange={(v) => update("enabled", v)}
          />
          <Title>Reminder Date</Title>
          <Chips
            items={["1", "15", "Last day"]}
            value={r.day}
            onChange={(v) => update("day", v)}
          />
          <Field
            label="Reminder Time (HH:MM)"
            value={r.time}
            onChangeText={(v) => update("time", v)}
            onEndEditing={() => {
              if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) {
                update("time", "10:00");
                Alert.alert(
                  "Invalid time",
                  "Use 24-hour HH:MM format. Reset to 10:00.",
                );
              }
            }}
          />
          <Field
            label="Minimum Outstanding (₹)"
            keyboardType="decimal-pad"
            value={r.minimum}
            onChangeText={(v) => update("minimum", v)}
            onEndEditing={() => {
              if (!Number.isFinite(Number(r.minimum)) || Number(r.minimum) < 0)
                update("minimum", "100");
            }}
          />
          <Toggle
            label="WhatsApp"
            value={r.whatsapp}
            onChange={(v) => update("whatsapp", v)}
          />
          <Toggle
            label="SMS"
            value={r.sms}
            onChange={(v) => update("sms", v)}
          />
        </>
      );
      break;
    }
    case "help": {
      const faqs = [
        [
          "How do I add a customer?",
          "Open Customers, tap Add Customer, enter their name and optional details, then Save Customer.",
        ],
        [
          "How do I record payment?",
          "Open a customer, tap Payment, enter the amount, date and method, then Save Payment.",
        ],
        [
          "How is balance calculated?",
          "Outstanding = opening balance + udhari − payments. A negative balance means the customer has paid in advance.",
        ],
        [
          "How do I send WhatsApp reminders?",
          "Open Khata, select a customer and month, then WhatsApp / SMS Share. Add the customer’s phone number and enable their reminders first.",
        ],
        [
          "How do I keep my data safe?",
          "Use Settings → Save backup to export a JSON copy. Restore it through Settings → Restore backup. This version has no cloud sync.",
        ],
      ];
      content = (
        <>
          <Field
            label="Search Help"
            placeholder="Search common questions"
            value={search}
            onChangeText={setSearch}
          />
          <Title>Common Questions</Title>
          {faqs
            .filter(([q, a]) =>
              (q + a).toLowerCase().includes(search.toLowerCase()),
            )
            .map(([q, a]) => (
              <Card key={q}>
                <Row title={q} onPress={() => setFaq(faq === q ? "" : q)} />
                {faq === q && <Hint>{a}</Hint>}
              </Card>
            ))}
          <Hint>
            WhatsApp and call support are not configured. Add your business
            support contact before production release.
          </Hint>
          <Button
            title="WhatsApp Support"
            onPress={() =>
              Alert.alert(
                "Support not configured",
                "Add your business WhatsApp support number before release.",
              )
            }
          />
          <Button
            title="Call Support"
            secondary
            onPress={() =>
              Alert.alert(
                "Support not configured",
                "Add your business support phone number before release.",
              )
            }
          />
        </>
      );
      break;
    }
    case "subscription":
      content = (
        <>
          {[
            { name: "Free", price: "₹0", detail: "50 customers" },
            {
              name: "Pro",
              price: "₹199/mo",
              detail: "500 customers • Popular",
            },
            {
              name: "Business",
              price: "₹499/mo",
              detail: "Unlimited customers",
            },
          ].map((p) => (
            <Pressable key={p.name} onPress={() => setPlan(p.name)}>
              <Card
                style={{
                  borderColor: plan === p.name ? colors.green : colors.border,
                  borderWidth: plan === p.name ? 2 : 1,
                }}
              >
                <View style={s.split}>
                  <Text style={[s.heading, { fontSize: 20 }]}>{p.name}</Text>
                  <Text style={s.stat}>{p.price}</Text>
                </View>
                <Hint>{p.detail}</Hint>
              </Card>
            </Pressable>
          ))}
          <Button
            title="Upgrade"
            onPress={() =>
              Alert.alert(
                "Plan preview",
                `${plan} is selected. Billing is not connected and no payment will be taken.`,
              )
            }
          />
          <Hint>
            Plan designs from the PDF. Purchases and customer limits are not
            enabled in this local version.
          </Hint>
        </>
      );
      break;
    case "account":
      content = (
        <>
          <Card>
            <Title>Are you sure you want to logout?</Title>
            <Hint>
              Your data will remain on this device. There is no cloud backup in
              this version.
            </Hint>
            <Button
              title="Cancel"
              secondary
              onPress={() => go("home", undefined, true)}
            />
            <Button
              title="Logout"
              onPress={() =>
                save({ ...data, signedIn: false }, () => {
                  setPhone("");
                  setOtp("");
                  go("welcome", undefined, true);
                })
              }
            />
          </Card>
          <Title>Delete local account</Title>
          <Hint>
            This permanently removes this shop, customers, transactions, and
            activity history from this device. Export a backup first.
          </Hint>
          <Field
            label="Type DELETE to confirm"
            value={form.confirm || ""}
            onChangeText={(v) => f("confirm", v)}
            autoCapitalize="characters"
          />
          <Button
            title="Delete account"
            danger
            disabled={form.confirm !== "DELETE" || busy}
            onPress={() =>
              Alert.alert(
                "Permanently delete all local data?",
                "This cannot be undone. Exported backups will not be deleted.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete permanently",
                    style: "destructive",
                    onPress: deleteLocalAccount,
                  },
                ],
              )
            }
          />
        </>
      );
      break;
    case "audit":
      content = (
        <>
          <Hint>
            Local history of customer changes and transaction edits or
            deletions. This is not a server-secured audit log.
          </Hint>
          {data.audit.map((a) => (
            <Card key={a.id}>
              <Title>{a.action}</Title>
              <Hint>{new Date(a.date).toLocaleString("en-IN")}</Hint>
              {a.before && (
                <Hint>
                  Before: {money(a.before.amount)} • {a.before.date} •{" "}
                  {a.before.note}
                </Hint>
              )}
              {a.after && (
                <Hint>
                  After: {money(a.after.amount)} • {a.after.date} •{" "}
                  {a.after.note}
                </Hint>
              )}
            </Card>
          ))}
          {!data.audit.length && (
            <Empty
              title="No activity yet"
              description="Changes you make to this khata will appear here."
            />
          )}
        </>
      );
      break;
  }
  if (loadError)
    return (
      <SafeAreaView
        style={[s.container, { padding: 24, justifyContent: "center" }]}
      >
        <Title>Your khata could not be opened safely</Title>
        <Hint>
          Please restart the app and check device storage. Existing stored data
          has not been replaced.
        </Hint>
      </SafeAreaView>
    );
  if (!loaded)
    return (
      <SafeAreaView
        style={[
          s.container,
          { justifyContent: "center", alignItems: "center", gap: 20 },
        ]}
      >
        <View style={s.logo}>
          <Text style={{ color: "white", fontSize: 48 }}>₹</Text>
        </View>
        <Text style={s.hero}>Digital Khata</Text>
        <Hint>Udhari ka hisaab, ab aur bhi aasan</Hint>
        <ActivityIndicator color={colors.green} />
      </SafeAreaView>
    );
  const tabs: {
    screen: Screen;
    label: string;
    icon: React.ComponentProps<typeof Icon>["name"];
  }[] = [
    { screen: "home", label: "Home", icon: "home-outline" },
    { screen: "customers", label: "Customers", icon: "people-outline" },
    { screen: "credit", label: "Add", icon: "add" },
    { screen: "khata", label: "Khata", icon: "book-outline" },
    { screen: "more", label: "More", icon: "ellipsis-horizontal" },
  ];
  const showNav =
    data.signedIn &&
    !["setup", "welcome", "login", "otp"].includes(route.screen);
  return (
    <LanguageContext.Provider value={data.language}>
      <SafeAreaView style={s.container} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        {route.screen !== "welcome" && route.screen !== "home" && (
          <View style={s.header}>
            {(history.length > 0 ||
              !tabs.some((t) => t.screen === route.screen)) && (
              <Pressable
                accessibilityLabel="Go back"
                onPress={back}
                style={{ padding: 3 }}
              >
                <Icon name="chevron-back" color={colors.dark} />
              </Pressable>
            )}
            <Text style={s.heading}>
              {route.screen === "customer"
                ? customer?.name
                : route.screen === "customerForm" && route.id
                  ? "Edit Customer"
                  : titles[route.screen]}
            </Text>
          </View>
        )}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            key={`${route.screen}-${route.id || ""}`}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.content}
          >
            {content}
          </ScrollView>
        </KeyboardAvoidingView>
        {showNav && (
          <View style={s.nav}>
            {tabs.map((t) => (
              <Pressable
                key={t.screen}
                accessibilityRole="button"
                accessibilityLabel={t.label}
                onPress={() => go(t.screen, undefined, true)}
                style={s.navItem}
              >
                <View style={t.label === "Add" ? s.add : undefined}>
                  <Icon
                    name={t.icon}
                    color={
                      t.label === "Add"
                        ? "white"
                        : route.screen === t.screen
                          ? colors.green
                          : colors.muted
                    }
                    size={t.label === "Add" ? 28 : 23}
                  />
                </View>
                <Text
                  style={[
                    s.navLabel,
                    route.screen === t.screen && {
                      color: colors.green,
                      fontWeight: "700",
                    },
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </SafeAreaView>
    </LanguageContext.Provider>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}
