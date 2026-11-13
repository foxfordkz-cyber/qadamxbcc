# SPEC.md — ITU Hackathon 2026: Bank CenterCredit (BCC) Fintech Case

## 1. Hackathon Context & Official Requirements
- **Event:** V Regional ITU Hackathon-2026
- **Case Provider:** Bank CenterCredit (BCC Bank, Kazakhstan)
- **Domain:** Banking Security, Real-Time Antifraud & Customer Protection during Money Transfers
- **Key Deadlines:**
  - Semifinal Submission: November 26, 2026 (Deliverables: Project Description, Pitch Deck, Working MVP/Prototype, Public/Demo GitHub Repository)
  - Final / Demo Day (Offline Only): December 11, 2026
- **Pitch & Evaluation Format (10 min total):**
  - 5 min: Pitch presentation (Problem, Architecture, Innovation, Business ROI for BCC)
  - 3 min: Live Interactive MVP Demo (Must work smoothly without manual data entry; use deterministic demo presets)
  - 2 min: Jury Q&A (Latency, KZ Data Privacy Law compliance, False Positive Rate, Integration into Core Banking)
- **Jury Evaluation Criteria:**
  1. Problem Relevance (Social engineering, drop networks, unauthorized transfers in KZ)
  2. Innovation (Behavioral + Graph + Adaptive Cooling-Off instead of rigid blocking)
  3. Technical Implementation & Code Quality (Real DB/Redis/Graph stack, <50ms scoring latency, clean architecture)
  4. MVP Completeness (End-to-end working flow from user transfer to SOC officer dashboard)
  5. Practical Applicability & Scalability (Low false positives, easy REST/gRPC integration)

## 2. Core Case Objectives
1. **Prevent Financial Fraud:** Stop scam transfers before funds leave the sender's account.
2. **Protect Customers During Transfers:** Detect active social engineering (phone call during transfer, sudden deposit withdrawal, night/new-device anomalies) and trigger a 15-minute **Cooling-Off Period** with an interactive anti-scam check.
3. **Detect Suspicious Transactions & Drop Networks:** Identify money-mule ("dropper") hubs via real-time graph analysis (fan-in velocity, transit chains, shared `device_id`/IP) and Redis sliding-window counters.
4. **Intelligent & Explainable Security:** Provide transparent risk scores (`0–100`) and human-readable explanations in both **Kazakh (`kk`)** and **Russian (`ru`)** for both the customer and the BCC Security Operations Center (SOC) officer.

## 3. Product Architecture: "BCC Shield" (Three-Layer Real-Time Pipeline)
- **Layer 1 — Behavioral & Context Guard (<15ms):** Evaluates transfer context (active call flag, deposit-to-transfer sequence, amount deviation from user's historical average, new device/geo, night hours).
- **Layer 2 — Velocity & Drop-Network Graph Engine (<25ms):**
  - Redis sliding windows: incoming/outgoing transfer count & volume over 10m / 1h / 24h.
  - NetworkX / DB Graph metrics: recipient `in_degree`, fan-in/fan-out transit ratio, shared device/IP clusters.
- **Layer 3 — Adaptive Decision & Bilingual Explainability (<10ms):**
  - `Score 0–39 (APPROVED)`: Instant transfer, zero friction.
  - `Score 40–74 (COOLING_OFF)`: 15-minute hold + bilingual anti-scam verification prompt + trusted contact alert option.
  - `Score 75–100 (BLOCKED)`: Immediate block + structured risk breakdown (`reasons_kk`, `reasons_ru`) for SOC investigation.

## 4. Demo Requirements (Critical for 3-Minute Live Showcase)
- **Bilingual UI (`ҚАЗ / РУС`):** Global instant language switcher across all screens, alerts, and AI explanations.
- **Preset Scenarios (One-Click Demo Triggers):**
  1. *Legitimate P2P Transfer* -> `APPROVED` (<30ms latency).
  2. *Social Engineering Victim* (Active call + deposit withdrawal + new recipient) -> `COOLING_OFF` modal in KZ/RU.
  3. *Dropper Hub Network* (Recipient receiving 12+ transfers in 30m) -> `BLOCKED` + live node/edge highlight on the SOC React Flow graph.