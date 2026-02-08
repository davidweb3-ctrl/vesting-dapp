import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-8">
      <div className="space-y-4">
        <h1 className="text-5xl md:text-6xl font-bold text-white">
          Secure Token{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
            Vesting
          </span>
        </h1>
        <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
          On-chain token custody with time-based release. Create vesting
          schedules, deposit tokens, and let beneficiaries claim automatically
          &mdash; all on Solana.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href="/create"
          className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-colors"
        >
          Create Vesting
        </Link>
        <Link
          href="/dashboard"
          className="px-8 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold rounded-lg transition-colors border border-zinc-700"
        >
          View Dashboard
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 max-w-4xl mx-auto w-full">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-left">
          <div className="text-indigo-400 text-2xl mb-3">1</div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Create Schedule
          </h3>
          <p className="text-zinc-400 text-sm">
            Define beneficiary, token amount, cliff period, and vesting
            duration. All parameters are stored immutably on-chain.
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-left">
          <div className="text-indigo-400 text-2xl mb-3">2</div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Deposit Tokens
          </h3>
          <p className="text-zinc-400 text-sm">
            Fund the vesting vault with SPL tokens. Tokens are held in a
            Program Derived Address, eliminating single-point custody risk.
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-left">
          <div className="text-indigo-400 text-2xl mb-3">3</div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Claim Tokens
          </h3>
          <p className="text-zinc-400 text-sm">
            Beneficiaries claim vested tokens at any time. Release follows a
            cliff + linear schedule, calculated on-chain.
          </p>
        </div>
      </div>
    </div>
  );
}
