//! Byte-level automaton for the canonical JSON that the TypeScript SDK hashes (`canonicalQuoteAndTxJson`)
//! on the eip3009 rail. The circuit checks every byte against this automaton through one lookup table, so
//! a proof exists only for bytes that ARE such canonical JSON, and the fields it compares (payTo / amount in
//! the quote, to / value in the authorization) are taken from their real positions.
//!
//! Canonical JSON never contains a backslash, a NUL byte or unescaped quotes inside values, and its keys are
//! sorted, so the shape below is fixed:
//!
//! quote: {"intent":null,"network":"eip155:<d+>","quote":{"amount":"<d{1,38}>","asset":"0x<h{40}>",
//!         "chainId":"<d+>","payTo":"0x<h{40}>"}}
//! tx:    {"network":"eip155:<d+>","payload":{"authorization":{"from":"0x<h{40}>",
//!         "kind":"(TransferWithAuthorization|ReceiveWithAuthorization)","nonce":"(|0x<h*>)",
//!         "to":"0x<h{40}>","validAfter":"<d+>","validBefore":(null|"<d+>"),"value":"<d{1,38}>"},
//!         "intent":null,"tx":null,"type":"eip3009"}}
//!
//! `h` is lowercase hex (the SDK lowercases every 0x-hex string). Amounts are limited to 38 digits so they
//! fit a u128 exactly as `quote-rules::parse_u128` requires. After the closing brace only NUL padding is
//! accepted, up to the fixed region size. Anything else (other rails, null fields, Q-005, Q-DECODE inputs)
//! has no proof here; those verdicts stay on the SP1 path.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

/// What a transition contributes to the field accumulators.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct Tag {
    /// Byte is a hex digit of the compared address (quote `payTo` / authorization `to`).
    pub is_addr: bool,
    /// Byte is a decimal digit of the compared amount (quote `amount` / authorization `value`).
    pub is_dec: bool,
    /// Digit value (0..15), 0 when neither flag is set.
    pub val: u8,
}

#[derive(Clone, Debug)]
enum Piece {
    Lit(&'static str),
    Hex { n: usize, addr: bool },
    HexLoop,
    DigitsLoop,
    Amount,
    Alt(Vec<Vec<Piece>>),
}

const AMOUNT_MAX_DIGITS: usize = 38;

fn quote_pieces() -> Vec<Piece> {
    use Piece::*;
    vec![
        Lit(r#"{"intent":null,"network":"eip155:"#),
        DigitsLoop,
        Lit(r#"","quote":{"amount":""#),
        Amount,
        Lit(r#"","asset":"0x"#),
        Hex { n: 40, addr: false },
        Lit(r#"","chainId":""#),
        DigitsLoop,
        Lit(r#"","payTo":"0x"#),
        Hex { n: 40, addr: true },
        Lit(r#""}}"#),
    ]
}

fn tx_pieces() -> Vec<Piece> {
    use Piece::*;
    vec![
        Lit(r#"{"network":"eip155:"#),
        DigitsLoop,
        Lit(r#"","payload":{"authorization":{"from":"0x"#),
        Hex { n: 40, addr: false },
        Lit(r#"","kind":""#),
        Alt(vec![vec![Lit("TransferWithAuthorization")], vec![Lit("ReceiveWithAuthorization")]]),
        Lit(r#"","nonce":""#),
        Alt(vec![vec![], vec![Lit("0x"), HexLoop]]),
        Lit(r#"","to":"0x"#),
        Hex { n: 40, addr: true },
        Lit(r#"","validAfter":""#),
        DigitsLoop,
        Lit(r#"","validBefore":"#),
        Alt(vec![vec![Lit("null")], vec![Lit("\""), DigitsLoop, Lit("\"")]]),
        Lit(r#","value":""#),
        Amount,
        Lit(r#""},"intent":null,"tx":null,"type":"eip3009"}}"#),
    ]
}

#[derive(Default)]
struct Nfa {
    /// edges[state] = (byte or epsilon, tag, target)
    edges: Vec<Vec<(Option<u8>, Tag, usize)>>,
}

impl Nfa {
    fn state(&mut self) -> usize {
        self.edges.push(Vec::new());
        self.edges.len() - 1
    }
    fn edge(&mut self, from: usize, byte: Option<u8>, tag: Tag, to: usize) {
        self.edges[from].push((byte, tag, to));
    }
    fn hex_edges(&mut self, from: usize, to: usize, addr: bool) {
        for (v, b) in (b'0'..=b'9').chain(b'a'..=b'f').enumerate() {
            let tag = if addr { Tag { is_addr: true, is_dec: false, val: v as u8 } } else { Tag::default() };
            self.edge(from, Some(b), tag, to);
        }
    }
    fn digit_edges(&mut self, from: usize, to: usize, dec: bool) {
        for b in b'0'..=b'9' {
            let tag = if dec { Tag { is_addr: false, is_dec: true, val: b - b'0' } } else { Tag::default() };
            self.edge(from, Some(b), tag, to);
        }
    }
    /// Builds `pieces` starting at `start`; returns the end state.
    fn build(&mut self, pieces: &[Piece], start: usize) -> usize {
        let mut cur = start;
        for p in pieces {
            cur = match p {
                Piece::Lit(s) => {
                    for &b in s.as_bytes() {
                        let n = self.state();
                        self.edge(cur, Some(b), Tag::default(), n);
                        cur = n;
                    }
                    cur
                }
                Piece::Hex { n, addr } => {
                    for _ in 0..*n {
                        let nx = self.state();
                        self.hex_edges(cur, nx, *addr);
                        cur = nx;
                    }
                    cur
                }
                Piece::HexLoop => {
                    let l = self.state();
                    self.edge(cur, None, Tag::default(), l);
                    self.hex_edges(l, l, false);
                    l
                }
                Piece::DigitsLoop => {
                    let l = self.state();
                    self.digit_edges(cur, l, false);
                    self.digit_edges(l, l, false);
                    l
                }
                Piece::Amount => {
                    let end = self.state();
                    let mut s = cur;
                    for i in 0..AMOUNT_MAX_DIGITS {
                        let nx = self.state();
                        self.digit_edges(s, nx, true);
                        s = nx;
                        let _ = i;
                        self.edge(s, None, Tag::default(), end);
                    }
                    end
                }
                Piece::Alt(branches) => {
                    let end = self.state();
                    for br in branches {
                        let e = self.build(br, cur);
                        self.edge(e, None, Tag::default(), end);
                    }
                    end
                }
            };
        }
        cur
    }
    fn closure(&self, set: &BTreeSet<usize>) -> BTreeSet<usize> {
        let mut out = set.clone();
        let mut stack: Vec<usize> = set.iter().copied().collect();
        while let Some(s) = stack.pop() {
            for &(b, _, t) in &self.edges[s] {
                if b.is_none() && out.insert(t) {
                    stack.push(t);
                }
            }
        }
        out
    }
}

/// Deterministic automaton shared by the circuit (lookup table) and the witness generator.
#[derive(Debug)]
pub struct Dfa {
    pub quote_start: u64,
    pub tx_start: u64,
    pub quote_pad: u64,
    pub tx_pad: u64,
    /// (state, byte) -> (next state, tag). State 0 is reserved (never reachable).
    pub trans: BTreeMap<(u64, u8), (u64, Tag)>,
    pub num_states: u64,
}

impl Dfa {
    pub fn step(&self, state: u64, byte: u8) -> Option<(u64, Tag)> {
        self.trans.get(&(state, byte)).copied()
    }
    /// Table rows (state, byte, next, is_addr, is_dec, val), led by the all-zero row used by disabled rows.
    pub fn table_rows(&self) -> Vec<[u64; 6]> {
        let mut rows = vec![[0u64; 6]];
        for (&(s, b), &(n, t)) in &self.trans {
            rows.push([s, b as u64, n, t.is_addr as u64, t.is_dec as u64, t.val as u64]);
        }
        rows
    }
}

fn build_dfa() -> Dfa {
    let mut nfa = Nfa::default();
    let mut starts_and_pads = Vec::new();
    for pieces in [quote_pieces(), tx_pieces()] {
        let start = nfa.state();
        let end = nfa.build(&pieces, start);
        let pad = nfa.state();
        nfa.edge(end, Some(0), Tag::default(), pad);
        nfa.edge(pad, Some(0), Tag::default(), pad);
        starts_and_pads.push((start, pad));
    }

    let mut ids: BTreeMap<BTreeSet<usize>, u64> = BTreeMap::new();
    let mut queue: Vec<BTreeSet<usize>> = Vec::new();
    let mut trans = BTreeMap::new();
    let intern = |set: BTreeSet<usize>, ids: &mut BTreeMap<BTreeSet<usize>, u64>, queue: &mut Vec<BTreeSet<usize>>| -> u64 {
        if let Some(&id) = ids.get(&set) {
            return id;
        }
        let id = ids.len() as u64 + 1;
        ids.insert(set.clone(), id);
        queue.push(set);
        id
    };

    let mut start_ids = Vec::new();
    for &(start, _) in &starts_and_pads {
        let c = nfa.closure(&BTreeSet::from([start]));
        start_ids.push(intern(c, &mut ids, &mut queue));
    }
    while let Some(set) = queue.pop() {
        let from = ids[&set];
        let mut by_byte: BTreeMap<u8, (Tag, BTreeSet<usize>)> = BTreeMap::new();
        for &s in &set {
            for &(b, tag, t) in &nfa.edges[s] {
                if let Some(b) = b {
                    let e = by_byte.entry(b).or_insert((tag, BTreeSet::new()));
                    assert_eq!(e.0, tag, "template is ambiguous at byte {b:#x}");
                    e.1.insert(t);
                }
            }
        }
        for (b, (tag, targets)) in by_byte {
            let to = intern(nfa.closure(&targets), &mut ids, &mut queue);
            trans.insert((from, b), (to, tag));
        }
    }
    let pad_id = |pad: usize| ids[&BTreeSet::from([pad])];
    Dfa {
        quote_start: start_ids[0],
        tx_start: start_ids[1],
        quote_pad: pad_id(starts_and_pads[0].1),
        tx_pad: pad_id(starts_and_pads[1].1),
        num_states: ids.len() as u64,
        trans,
    }
}

pub fn dfa() -> &'static Dfa {
    static DFA: OnceLock<Dfa> = OnceLock::new();
    DFA.get_or_init(build_dfa)
}

/// Runs the automaton over `bytes` padded with NUL to `max`. `None` if the bytes are not canonical
/// eip3009 JSON of this shape or leave no room for at least one padding byte.
pub fn run(bytes: &[u8], max: usize, start: u64, pad: u64) -> Option<(Vec<u64>, Vec<Tag>)> {
    if bytes.len() >= max {
        return None;
    }
    let d = dfa();
    let mut states = Vec::with_capacity(max + 1);
    let mut tags = Vec::with_capacity(max);
    let mut s = start;
    states.push(s);
    for i in 0..max {
        let b = if i < bytes.len() { bytes[i] } else { 0 };
        let (n, t) = d.step(s, b)?;
        tags.push(t);
        s = n;
        states.push(s);
    }
    (s == pad).then_some((states, tags))
}
