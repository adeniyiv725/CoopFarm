;; ProfitDistributorContract.clar
;; Core contract for distributing profits in CoopFarm based on immutable contributions.
;; Integrates with ContributionTrackerContract, MembershipContract, and OracleFeedContract.

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-NO-CONTRIBUTIONS u102)
(define-constant ERR-DISTRIBUTION-ACTIVE u103)
(define-constant ERR-NO-PROFITS u104)
(define-constant ERR-INVALID-MEMBER u105)
(define-constant ERR-PAUSED u106)
(define-constant ERR-INVALID-PERIOD u107)
(define-constant ERR-ALREADY-CLAIMED u108)
(define-constant ERR-INSUFFICIENT-BALANCE u109)
(define-constant ERR-ORACLE-FAIL u110)
(define-constant ERR-INVALID-CONFIG u111)
(define-constant MAX-VESTING-PERIODS u12)

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var is-paused bool false)
(define-data-var total-distributed uint u0)
(define-data-var distribution-counter uint u0)
(define-data-var vesting-enabled bool false)
(define-data-var vesting-period uint u100)
(define-data-var fee-percentage uint u1)

;; Data Maps
(define-map member-shares
  { cooperative-id: uint, member: principal }
  { share: uint, last-claimed: uint }
)

(define-map distributions
  { distribution-id: uint }
  {
    total-revenue: uint,
    total-contributions: uint,
    timestamp: uint,
    cooperative-id: uint,
    status: (string-ascii 20),
    fee-collected: uint
  }
)

(define-map vesting-schedules
  { distribution-id: uint, member: principal }
  {
    total-entitled: uint,
    periods: uint,
    claimed-periods: uint,
    start-block: uint
  }
)

(define-map cooperative-configs
  { cooperative-id: uint }
  {
    min-share-threshold: uint,
    max-members: uint,
    auto-distribute: bool,
    oracle-principal: principal
  }
)

(define-map distribution-history
  { member: principal, index: uint }
  { distribution-id: uint, amount-claimed: uint, timestamp: uint }
)

(define-map pending-profits
  { cooperative-id: uint }
  { amount: uint }
)

;; Traits
(define-trait contribution-tracker-trait
  (
    (get-total-contributions (uint) (response uint uint))
    (get-member-contribution (uint principal) (response uint uint))
  )
)

(define-trait membership-trait
  (
    (is-valid-member (uint principal) (response bool uint))
    (get-active-members (uint) (response (list 100 principal) uint))
  )
)

(define-trait oracle-trait
  (
    (get-revenue-data (uint) (response uint uint))
  )
)

;; Private Functions
(define-private (calculate-share (contribution uint) (total-contributions uint) (revenue uint))
  (if (is-eq total-contributions u0)
    u0
    (/ (* contribution revenue) total-contributions)
  )
)

(define-private (apply-fee (amount uint))
  (/ (* amount (- u100 (var-get fee-percentage))) u100)
)

(define-private (collect-fee (amount uint))
  (/ (* amount (var-get fee-percentage)) u100)
)

(define-private (is-contract-owner (caller principal))
  (is-eq caller (var-get contract-owner))
)

(define-private (transfer-stx (amount uint) (recipient principal))
  (try! (as-contract (stx-transfer? amount tx-sender recipient)))
  (ok amount)
)

;; Public Functions
(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-UNAUTHORIZED))
    (ok (var-set contract-owner new-owner))
  )
)

(define-public (pause)
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-UNAUTHORIZED))
    (ok (var-set is-paused true))
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-UNAUTHORIZED))
    (ok (var-set is-paused false))
  )
)

(define-public (set-fee-percentage (new-fee uint))
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (<= new-fee u10) (err ERR-INVALID-CONFIG))
    (ok (var-set fee-percentage new-fee))
  )
)

(define-public (set-vesting-enabled (enabled bool) (period uint))
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (> period u0) (err ERR-INVALID-PERIOD))
    (var-set vesting-enabled enabled)
    (ok (var-set vesting-period period))
  )
)

(define-public (configure-cooperative (co-op-id uint) (min-threshold uint) (max-members uint) (auto bool) (oracle principal))
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (> max-members u0) (err ERR-INVALID-CONFIG))
    (ok (map-set cooperative-configs
      { cooperative-id: co-op-id }
      { min-share-threshold: min-threshold, max-members: max-members, auto-distribute: auto, oracle-principal: oracle }))
  )
)

(define-public (deposit-profits (co-op-id uint) (amount uint))
  (begin
    (asserts! (not (var-get is-paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (let ((current-pending (default-to u0 (get amount (map-get? pending-profits { cooperative-id: co-op-id })))))
      (ok (map-set pending-profits { cooperative-id: co-op-id } { amount: (+ current-pending amount) })))
  )
)

(define-public (initiate-distribution (co-op-id uint))
  (let
    (
      (config (unwrap! (map-get? cooperative-configs { cooperative-id: co-op-id }) (err ERR-INVALID-CONFIG)))
      (oracle (get oracle-principal config))
      (revenue (unwrap! (contract-call? .oracle-feed-contract get-revenue-data co-op-id) (err ERR-ORACLE-FAIL)))
      (total-contribs (unwrap! (contract-call? .contribution-tracker-contract get-total-contributions co-op-id) (err ERR-NO-CONTRIBUTIONS)))
      (pending (default-to u0 (get amount (map-get? pending-profits { cooperative-id: co-op-id }))))
    )
    (asserts! (not (var-get is-paused)) (err ERR-PAUSED))
    (asserts! (> (+ revenue pending) u0) (err ERR-NO-PROFITS))
    (let
      (
        (dist-id (+ (var-get distribution-counter) u1))
        (total-revenue (+ revenue pending))
        (fee (collect-fee total-revenue))
        (net-revenue (- total-revenue fee))
      )
      (var-set distribution-counter dist-id)
      (map-set distributions
        { distribution-id: dist-id }
        { total-revenue: net-revenue, total-contributions: total-contribs, timestamp: block-height, cooperative-id: co-op-id, status: "active", fee-collected: fee })
      (map-delete pending-profits { cooperative-id: co-op-id })
      (try! (as-contract (stx-transfer? fee tx-sender (var-get contract-owner))))
      (if (get auto-distribute config)
        (try! (distribute-profits dist-id))
        (ok dist-id))
    )
  )
)

(define-public (distribute-profits (dist-id uint))
  (let
    (
      (dist (unwrap! (map-get? distributions { distribution-id: dist-id }) (err ERR-NO-PROFITS)))
      (co-op-id (get cooperative-id dist))
      (members (unwrap! (contract-call? .membership-contract get-active-members co-op-id) (err ERR-INVALID-MEMBER)))
      (total-revenue (get total-revenue dist))
      (total-contribs (get total-contributions dist))
    )
    (asserts! (not (var-get is-paused)) (err ERR-PAUSED))
    (asserts! (is-eq (get status dist) "active") (err ERR-DISTRIBUTION-ACTIVE))
    (map-set distributions { distribution-id: dist-id } (merge dist { status: "completed" }))
    (fold distribute-to-member members (ok u0))
    (var-set total-distributed (+ (var-get total-distributed) total-revenue))
    (ok true)
  )
)

(define-private (distribute-to-member (member principal) (acc (response uint uint)))
  (let
    (
      (dist-id (var-get distribution-counter))
      (dist (unwrap-panic (map-get? distributions { distribution-id: dist-id })))
      (contrib (unwrap-panic (contract-call? .contribution-tracker-contract get-member-contribution (get cooperative-id dist) member)))
      (share (calculate-share contrib (get total-contributions dist) (get total-revenue dist)))
      (config (unwrap-panic (map-get? cooperative-configs { cooperative-id: (get cooperative-id dist) })))
    )
    (if (>= share (get min-share-threshold config))
      (if (var-get vesting-enabled)
        (map-set vesting-schedules
          { distribution-id: dist-id, member: member }
          { total-entitled: share, periods: MAX-VESTING-PERIODS, claimed-periods: u0, start-block: block-height })
        (begin
          (map-set member-shares
            { cooperative-id: (get cooperative-id dist), member: member }
            { share: share, last-claimed: block-height })
          (unwrap-panic (transfer-stx share member))))
      u0)
    (ok (+ (unwrap-panic acc) share))
  )
)

(define-public (claim-vested-share (dist-id uint))
  (let
    (
      (schedule (unwrap! (map-get? vesting-schedules { distribution-id: dist-id, member: tx-sender }) (err ERR-ALREADY-CLAIMED)))
      (periods-elapsed (/ (- block-height (get start-block schedule)) (var-get vesting-period)))
      (claimable-periods (- (min periods-elapsed (get periods schedule)) (get claimed-periods schedule)))
      (period-amount (/ (get total-entitled schedule) (get periods schedule)))
      (claim-amount (* claimable-periods period-amount))
    )
    (asserts! (not (var-get is-paused)) (err ERR-PAUSED))
    (asserts! (> claim-amount u0) (err ERR-INVALID-AMOUNT))
    (map-set vesting-schedules
      { distribution-id: dist-id, member: tx-sender }
      (merge schedule { claimed-periods: (+ (get claimed-periods schedule) claimable-periods) }))
    (let ((dist (unwrap-panic (map-get? distributions { distribution-id: dist-id }))))
      (map-set member-shares
        { cooperative-id: (get cooperative-id dist), member: tx-sender }
        { share: claim-amount, last-claimed: block-height }))
    (unwrap-panic (transfer-stx claim-amount tx-sender))
    (ok claim-amount)
  )
)

(define-public (update-share (co-op-id uint) (member principal) (new-share uint))
  (begin
    (asserts! (is-contract-owner tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (> new-share u0) (err ERR-INVALID-AMOUNT))
    (let ((current (unwrap! (map-get? member-shares { cooperative-id: co-op-id, member: member }) (err ERR-INVALID-MEMBER))))
      (ok (map-set member-shares
        { cooperative-id: co-op-id, member: member }
        (merge current { share: new-share }))))
  )
)

;; Read-Only Functions
(define-read-only (get-distribution-details (dist-id uint))
  (map-get? distributions { distribution-id: dist-id })
)

(define-read-only (get-member-share (co-op-id uint) (member principal))
  (map-get? member-shares { cooperative-id: co-op-id, member: member })
)

(define-read-only (get-vesting-schedule (dist-id uint) (member principal))
  (map-get? vesting-schedules { distribution-id: dist-id, member: member })
)

(define-read-only (get-cooperative-config (co-op-id uint))
  (map-get? cooperative-configs { cooperative-id: co-op-id })
)

(define-read-only (get-pending-profits (co-op-id uint))
  (default-to u0 (get amount (map-get? pending-profits { cooperative-id: co-op-id })))
)

(define-read-only (get-total-distributed)
  (var-get total-distributed)
)

(define-read-only (get-distribution-history (member principal) (index uint))
  (map-get? distribution-history { member: member, index: index })
)

(define-read-only (is-contract-paused)
  (var-get is-paused)
)

(define-read-only (get-fee-percentage)
  (var-get fee-percentage)
)

(define-read-only (get-vesting-info)
  { enabled: (var-get vesting-enabled), period: (var-get vesting-period) }
)