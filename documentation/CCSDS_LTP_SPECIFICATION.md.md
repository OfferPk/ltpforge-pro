\# CCSDS 734.1-B-1 & IETF RFC 5326 Licklider Transmission Protocol Specification

\#\# 1\. Scope & Deep-Space Operational Domain  
The \*\*Consultative Committee for Space Data Systems (CCSDS)\*\* Recommendation \*\*CCSDS 734.1-B-1\*\* (and international standard \*\*IETF RFC 5326 / RFC 5327\*\*) establishes the normative specification for the \*\*Licklider Transmission Protocol (LTP)\*\*.

Designed named in honor of ARPANET pioneer J.C.R. Licklider, LTP provides reliable and best-effort point-to-point data transmission over deep-space communications links characterized by:  
\- Extremely long propagation delays (from seconds to hours, e.g. Earth-Moon 1.3s, Earth-Mars 4 to 20 minutes).  
\- High bit error rates (BER) and signal fading.  
\- Frequent line-of-sight occultation and intermittent scheduled contact windows.

\---

\#\# 2\. Red Data vs Green Data Architecture  
A single client block (such as an interplanetary DTN Bundle Protocol Version 7 bundle) can be partitioned into:  
\- \*\*Red Data\*\*: Reliable transmission requiring selective repeat automatic repeat request (ARQ). Transmission is verified via Checkpoint (CP) and Report Segment (RS) reception claims.  
\- \*\*Green Data\*\*: Unreliable, unacknowledged transmission (best-effort delivery) where lost segments are discarded without retransmission to conserve precious downlink power.

\---

\#\# 3\. Normative Segment Headers & Types  
LTP defines segment types encoded in a 4-bit field in the first nibble of Octet 0:  
\- \`0x0\`: Red Data, not Checkpoint, not EORP, not EOB  
\- \`0x1\`: Red Data, Checkpoint (CP), not EORP, not EOB  
\- \`0x2\`: Red Data, Checkpoint, EORP (End of Red Part), not EOB  
\- \`0x3\`: Red Data, Checkpoint, EORP, EOB (End of Block)  
\- \`0x4\`: Green Data, not EOB  
\- \`0x7\`: Green Data, EOB  
\- \`0x8\`: Report Segment (RS) containing reception claims  
\- \`0x9\`: Report Acknowledgment (RA) confirming RS receipt  
\- \`0xB\` / \`0xD\`: Cancel Segments (Sender / Receiver initiated)

\#\#\# Self-Delimiting Numeric Values (SDNV)  
Numeric fields (Engine IDs, Session Numbers, Offsets, Lengths, Serial Numbers) are variable-length encoded using 7-bit continuation octets (bit 7 set until the final octet).  
