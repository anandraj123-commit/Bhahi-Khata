import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, BookOpen, Gift, ShieldCheck, Users } from "lucide-react";

type Props = { params: Promise<{ code: string }> };
const referralCodePattern = /^[A-F0-9]{10}$/i;

export async function generateMetadata() {
  return {
    title: "Digital Khata — Refer & Earn",
    description: "Join Digital Khata and manage your shop's customer khata digitally.",
  };
}

async function ReferralLanding({ params }: Props) {
  const { code: rawCode } = await params;
  if (!referralCodePattern.test(rawCode)) notFound();
  const code = rawCode.toUpperCase();
  const company = process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() || "Digital Khata";
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  const companyAddress = process.env.NEXT_PUBLIC_COMPANY_ADDRESS?.trim();
  const companyPhone = process.env.NEXT_PUBLIC_COMPANY_PHONE?.trim();
  const companyWebsite = process.env.NEXT_PUBLIC_COMPANY_WEBSITE?.trim();
  const androidUrl = process.env.NEXT_PUBLIC_ANDROID_STORE_URL?.trim() || "https://play.google.com/store/apps/details?id=com.digitalkhata.app";
  const iosUrl = process.env.NEXT_PUBLIC_IOS_STORE_URL?.trim();
  const appUrl = `digitalkhata://refer/${code}`;
  return (
    <main className="min-h-screen bg-[#f3f7f5] px-4 py-10 text-[#123126] sm:py-16">
      <div className="mx-auto grid max-w-5xl overflow-hidden rounded-3xl border border-[#dce8e1] bg-white shadow-xl md:grid-cols-[1.1fr_.9fr]">
        <section className="flex flex-col justify-center p-7 sm:p-12">
          <div className="mb-8 flex items-center gap-3">
            <Image src="/digital-khata-icon.png" alt="Digital Khata app icon" width={52} height={52} className="rounded-2xl" priority />
            <div><p className="text-xl font-bold">Digital Khata</p><p className="text-sm text-emerald-800">Simple shop bookkeeping</p></div>
          </div>
          <p className="mb-3 inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800"><Gift size={16} /> A shopkeeper invited you</p>
          <h1 className="max-w-xl text-4xl font-extrabold tracking-tight sm:text-5xl">Keep your shop’s khata organized.</h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-slate-600">Digital Khata helps shopkeepers keep customer records, track udhari and payments, review balances, and access saved records offline.</p>
          <div className="mt-7 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/70 p-4">
            <p className="text-sm font-medium text-slate-600">Your referral code</p>
            <p className="mt-1 font-mono text-2xl font-extrabold tracking-[.18em] text-emerald-800">{code}</p>
            <p className="mt-2 text-sm text-slate-600">If the code is not carried into the app automatically, enter it when creating your shop.</p>
          </div>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a href={androidUrl} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 font-bold text-white hover:bg-emerald-800"><ArrowDownToLine size={19} /> Install for Android</a>
            {iosUrl ? <a href={iosUrl} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-5 font-semibold text-slate-800 hover:bg-slate-50">Install for iPhone</a> : null}
            <a href={appUrl} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-emerald-700 px-5 font-semibold text-emerald-800 hover:bg-emerald-50">Open the app</a>
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">Referral rewards are subject to the program’s current eligibility requirements. The reward is confirmed after the referred shop is created and meets the configured customer requirement.</p>
        </section>
        <aside className="flex flex-col justify-center gap-5 bg-[#eaf5ef] p-7 sm:p-12">
          <div className="rounded-2xl bg-white p-5 shadow-sm"><Users className="mb-3 text-emerald-700" size={24} /><h2 className="font-bold">Customer records</h2><p className="mt-1 text-sm leading-6 text-slate-600">Keep customer details and outstanding balances together.</p></div>
          <div className="rounded-2xl bg-white p-5 shadow-sm"><BookOpen className="mb-3 text-emerald-700" size={24} /><h2 className="font-bold">Udhari and payments</h2><p className="mt-1 text-sm leading-6 text-slate-600">Record transactions and review customer statements.</p></div>
          <div className="rounded-2xl bg-white p-5 shadow-sm"><ShieldCheck className="mb-3 text-emerald-700" size={24} /><h2 className="font-bold">Offline access</h2><p className="mt-1 text-sm leading-6 text-slate-600">Previously saved records remain available according to the app’s offline access rules.</p></div>
          <footer className="pt-3 text-sm text-slate-600"><p className="font-semibold text-slate-800">{company}</p>{companyAddress ? <p>{companyAddress}</p> : null}{companyPhone ? <p>Phone: <a className="underline" href={`tel:${companyPhone}`}>{companyPhone}</a></p> : null}{supportEmail ? <p>Support: <a className="underline" href={`mailto:${supportEmail}`}>{supportEmail}</a></p> : <p>Digital Khata app information and referral invitation.</p>}{companyWebsite ? <a href={companyWebsite} className="mt-2 inline-block underline">Company website</a> : <Link href="/" className="mt-2 inline-block underline">Visit website</Link>}</footer>
        </aside>
      </div>
    </main>
  );
}

export default function Page({ params }: Props) {
  return <Suspense fallback={<main className="min-h-screen bg-[#f3f7f5]" />}><ReferralLanding params={params} /></Suspense>;
}
