/*
 * RSA91A-Engine: citation library.
 *
 * Every built-in entry names the primary source it was checked against and
 * the statute edition that source cites. The app tells the user to confirm
 * current text at gc.nh.gov before relying on any entry; statutes change.
 * Users may add their own entries; those are marked user-supplied.
 *
 * Sources for the built-in entries:
 *  [GC]   RSA 91-A:4 as published at gc.nh.gov, source note ending "2024, 49:1, 2,
 *         eff. Aug. 13, 2024. 2026, 206:5, eff. Aug. 31, 2026." Text supplied by the
 *         publisher from gc.nh.gov on Nov. 10, 2026; the build environment could not
 *         open the site itself. The wording of paragraph I (first sentence),
 *         IV(b)(1)-(2), IV(d) (first sentence), V (first two sentences) and VI matches
 *         the court quotations below. Not in any court quotation found: the IV(a)
 *         website clause, the IV(b)(3) cost estimate, IV(c), IV(f), the last sentence
 *         of V, VIII and IX.
 * New Hampshire Supreme Court:
 *  [UL24] Union Leader Corp. v. N.H. Dep't of Safety, 2024 N.H. 35 (July 3, 2024),
 *         quoting RSA 91-A:4, I (2023).
 *  [CQ]   Colquhoun v. City of Nashua, No. 2021-0253 (Oct. 26, 2022), quoting
 *         RSA 91-A:4, IV(a) (Supp. 2021).
 *  [BR]   Brandano v. Superintendent of SAU 16, No. 2022-0084 (order, Nov. 3, 2023),
 *         quoting RSA 91-A:4, IV(b) and RSA 91-A:8, I (2023).
 *  [ST]   Stone v. City of Claremont, 2024 N.H. 11 (Mar. 20, 2024), quoting
 *         RSA 91-A:4, VI (2023) and citing RSA 91-A:4, IV(a)-(c) (2023).
 *  [MI]   Michaud v. Town of Campton Police Dep't, 2024 N.H. 19 (Apr. 18, 2024),
 *         on RSA 91-A:5, IV and XII (2023).
 *  [K]    Keene Publ'g Corp. v. Fall Mountain Reg'l Sch. Dist., 2025 N.H. 35
 *         (Aug. 12, 2025), on RSA 91-A:4, I-a and RSA 91-A:5, IV, XII (2023).
 *  [MR]   Martin v. City of Rochester (N.H. June 9, 2020), quoting the copy-cost
 *         sentence of RSA 91-A:4, IV (Supp. 2016), now IV(d).
 *  [T]    Taylor v. Sch. Admin. Unit #55, No. 2016-0702 (Sept. 21, 2017), quoting
 *         RSA 91-A:4, IV and V (Supp. 2016). Paragraph IV was restructured into
 *         lettered subparagraphs after this; entries resting on [T] alone are
 *         marked as such.
 */
(function (root) {
  'use strict';

  const SOURCES = {
    UL24: 'Union Leader Corp. v. N.H. Dep\'t of Safety, 2024 N.H. 35 (RSA 91-A:4, I (2023))',
    CQ: 'Colquhoun v. City of Nashua, No. 2021-0253 (N.H. Oct. 26, 2022) (RSA 91-A:4, IV(a) (Supp. 2021))',
    BR: 'Brandano v. Superintendent of SAU 16, No. 2022-0084 (N.H. Nov. 3, 2023) (RSA 91-A:4, IV(b); RSA 91-A:8, I (2023))',
    ST: 'Stone v. City of Claremont, 2024 N.H. 11 (RSA 91-A:4, VI (2023))',
    MI: 'Michaud v. Town of Campton Police Dep\'t, 2024 N.H. 19 (RSA 91-A:5, IV, XII (2023))',
    K: 'Keene Publ\'g Corp. v. Fall Mountain Reg\'l Sch. Dist., 2025 N.H. 35 (RSA 91-A:4, I-a; 91-A:5, IV, XII (2023))',
    T: 'Taylor v. Sch. Admin. Unit #55, No. 2016-0702 (N.H. Sept. 21, 2017) (RSA 91-A:4, IV, V (Supp. 2016))',
    MR: 'Martin v. City of Rochester (N.H. June 9, 2020) (RSA 91-A:4, IV copy-cost sentence (Supp. 2016))',
    GC: 'RSA 91-A:4 as published at gc.nh.gov, current through 2026 N.H. Laws 206:5 (eff. Aug. 31, 2026); text as of Nov. 10, 2026',
  };

  const CITATIONS = [
    {
      id: '91-A:4,I',
      cite: 'RSA 91-A:4, I',
      kind: 'access',
      title: 'Right to inspect and copy governmental records',
      summary: '"Every citizen during the regular or business hours of all public bodies or agencies, and on the regular business premises of such public bodies or agencies, has the right to inspect all governmental records in the possession, custody, or control of such public bodies or agencies, including minutes of meetings of the public bodies, and to copy and make memoranda or abstracts of the records or minutes so inspected, except as otherwise prohibited by statute or RSA 91-A:5." The paragraph goes on to define "to copy" as reproduction "by whatever method, including but not limited to photography, photostatic copy, printing, or electronic or tape recording." (Current text; the first sentence is unchanged from the 2023 edition the court quoted.)',
      source: 'GC, UL24, MI',
    },
    {
      id: '91-A:4,I-a',
      cite: 'RSA 91-A:4, I-a',
      kind: 'access',
      title: 'Separation payments',
      summary: 'Records of any payment made to an employee upon resignation, discharge, or retirement, in addition to regular salary and accrued leave, shall immediately be made available without alteration for public inspection. The court held a narrative summary does not satisfy this; the original payment records are required (confidential information may be redacted).',
      source: 'GC, K',
    },
    {
      id: '91-A:4,IV(a)',
      cite: 'RSA 91-A:4, IV(a)',
      kind: 'timing',
      title: 'Records immediately available',
      summary: '"Each public body or agency shall, upon request for any governmental record reasonably described, make available for inspection and copying any such governmental record within its files when such records are immediately available for such release or, if the record has been uploaded to the website in accordance with RSA 33-A:5-a, III, provide the domain name of the website." (Current text. The website clause is not in the Supp. 2021 text the court quoted.)',
      source: 'GC, CQ',
    },
    {
      id: '91-A:4,IV(b)',
      cite: 'RSA 91-A:4, IV(b)',
      kind: 'timing',
      title: 'Five-business-day response',
      summary: '"If a public body or agency is unable to make a governmental record available for immediate inspection and copying the public body or agency shall, within 5 business days of a request: (1) Make such record available; (2) Deny the request; or (3) Provide a written statement of the time reasonably necessary to determine whether the request shall be granted or denied and the reason for the delay, and an itemized estimate of the cost of making the record available if a charge would be incurred under paragraph VIII." (Current text. The itemized-estimate clause in (3) is not in the 2023 edition the court quoted.) The court has said the response period is absolute, and that a body that gives itself a deadline must answer follow-up inquiries when it misses it.',
      source: 'GC, BR',
    },
    {
      id: '91-A:4,IV(c)',
      cite: 'RSA 91-A:4, IV(c)',
      kind: 'denial',
      title: 'What a denial must say',
      summary: '"A public body or agency denying the request in whole or in part shall provide a written statement of the specific exemption authorizing the withholding of the record and a brief explanation of how the exemption applies to the record withheld." (Current text.)',
      source: 'GC',
    },
    {
      id: '91-A:4,IV(d)',
      cite: 'RSA 91-A:4, IV(d)',
      kind: 'fees',
      title: 'Copy costs',
      summary: '"If a computer, photocopying machine, or other device maintained for use by a public body or agency is used by the public body or agency to copy the governmental record requested, the person requesting the copy may be charged the actual cost of providing the copy, which cost may be collected by the public body or agency. No cost or fee shall be charged for the inspection or delivery, without copying, of governmental records, whether in paper, electronic, or other form, except as provided in paragraph VIII. Nothing in this section shall exempt any person from paying fees otherwise established by law for obtaining copies of governmental records or documents, but if such fee is established for the copy, no additional costs or fees shall be charged." (Current text.) The court has held that "actual cost" needs no formula; a fee schedule supported by testimony about copier, maintenance and paper costs, and by comparison with other towns, was enough.',
      source: 'GC, MR',
    },
    {
      id: '91-A:4,IV(f)',
      cite: 'RSA 91-A:4, IV(f)',
      kind: 'liability',
      title: 'Good-faith redaction: no damages liability',
      summary: '"A public body or agency responsible for responding to a records request shall not be liable for damages in a civil action caused by its fault or by fault attributable to it, arising out of disclosure of information exempt from disclosure pursuant to this chapter, provided that the public body or agency acted in good faith to redact any information that may be exempt from disclosure, unless the public body or agency can be shown to have acted in a wanton or reckless manner. The use of automated software to produce redactions or other automated processes to speed production in concert with spot checks shall qualify as good faith." (Current text.) No New Hampshire Supreme Court opinion applying this subparagraph was found as of Nov. 10, 2026. Whether a particular review process meets it is a question for the body and its counsel.',
      source: 'GC',
    },
    {
      id: '91-A:4,V',
      cite: 'RSA 91-A:4, V',
      kind: 'format',
      title: 'Electronic records and formats',
      summary: '"In the same manner as set forth in RSA 91-A:4, IV, any public body or agency which maintains governmental records in electronic format may, in lieu of providing original records, copy governmental records requested to electronic media using standard or common file formats in a manner that does not reveal information which is confidential under this chapter or any other law. If copying to electronic media is not reasonably practicable, or if the person or entity requesting access requests a different method, the public body or agency may provide a printout of governmental records requested, or may use any other means reasonably calculated to comply with the request in light of the purpose of this chapter as expressed in RSA 91-A:1. Access to work papers, personnel data, and other confidential information under RSA 91-A:5, IV shall not be provided." (Current text. The first two sentences match the 2016 text the court quoted in 2017; the last sentence is not in that quotation.)',
      source: 'GC, T',
    },
    {
      id: '91-A:4,VI',
      cite: 'RSA 91-A:4, VI',
      kind: 'access',
      title: 'Settlement agreements on file',
      summary: '"Every agreement to settle a lawsuit against a governmental unit, threatened lawsuit, or other claim, entered into by any political subdivision or its insurer, shall be kept on file at the municipal clerk\'s office and made available for public inspection for a period of no less than 10 years from the date of settlement." (Current text; unchanged from the 2023 edition the court quoted.)',
      source: 'GC, ST',
    },
    {
      id: '91-A:4,VIII',
      cite: 'RSA 91-A:4, VIII',
      kind: 'fees',
      title: 'Charges for more than 250 electronic communications',
      summary: '"A reasonable per electronic communication charge in addition to the actual cost of providing the copy under paragraph IV(d) may be made for requests for electronic communications in excess of 250 communications. Per electronic communication charges may not exceed $1.00 per communication and may be charged whether the records are delivered in hard copy or electronically. No charge may be incurred for the first 250 electronic communications." The paragraph also says attachments count as part of one communication; e-mails and responses under one subject line count as one; text or chat threads on one topic count as one up to 50 messages, then each further 50 counts as another. The body must adopt a written policy, including a waiver consistent with paragraph IX for indigent requesters or financial hardship. Multiple requests from one person or entity to the same body within 30 days count as one request. A requester may seek relief under RSA 91-A:7-b if the estimate is unreasonable or a waiver was improperly denied; the body bears the burden of showing the cost is reasonable, and a determination is due within 10 business days. (Current text, quoted in part and summarized in part.)',
      source: 'GC',
    },
    {
      id: '91-A:4,IX',
      cite: 'RSA 91-A:4, IX',
      kind: 'fees',
      title: 'Waiver of the paragraph VIII charge',
      summary: '"The public body or agency shall waive any per electronic communication charge provided for in paragraph VIII for search or retrieval when the person requesting the records is an indigent individual as established by the federal poverty line or if the disclosure of the information is in the public interest because it is likely to contribute significantly to public understanding of the operations or activities of the government and is not primarily in the commercial interest of the requestor, except media requestors. Media requestors are organizations or individuals who publish information in accepted digital, print, or broadcast formats and to standards generally recognized by professional news organizations that do not serve primarily as a platform to promote the interest and/or opinions of a special interest group, government, individual or cause." (Current text.) This paragraph governs only the waiver of the paragraph VIII charge. It creates no separate right of access; the access right in paragraph I is the same for every citizen.',
      source: 'GC',
    },
    {
      id: '91-A:5,IV',
      cite: 'RSA 91-A:5, IV',
      kind: 'exemption',
      title: 'Confidential, commercial, or financial information; personnel files; invasion of privacy',
      summary: 'Exempts, among other things, records pertaining to "confidential, commercial, or financial information" and personnel files whose disclosure would constitute an invasion of privacy. Courts apply a three-step balancing test: (1) is there a privacy interest; (2) what is the public interest in disclosure; (3) balance the public interest against the government\'s and the individual\'s interests in nondisclosure. Exemptions are construed restrictively; the withholding entity bears a heavy burden. Redaction of names and identifying details is preferred over withholding a whole record when it protects the privacy interest.',
      balancing: true,
      source: 'K, MI',
    },
    {
      id: '91-A:5,XII',
      cite: 'RSA 91-A:5, XII',
      kind: 'exemption',
      title: 'Attorney-client privilege and attorney work product',
      summary: 'Exempts "[r]ecords protected under the attorney-client privilege or the attorney work product doctrine" (added by Laws 2021, 163:2). No privacy balancing test applies; the established privilege doctrines govern.',
      balancing: false,
      source: 'K, MI',
    },
    {
      id: '91-A:8,I',
      cite: 'RSA 91-A:8, I',
      kind: 'remedy',
      title: 'Attorney\'s fees and costs',
      summary: '"If any public body or public agency or officer, employee, or other official thereof, violates any provisions of this chapter, such public body or public agency shall be liable for reasonable attorney\'s fees and costs incurred in a lawsuit under this chapter, provided that the court finds that such lawsuit was necessary in order to enforce compliance with the provisions of this chapter or to address a purposeful violation of this chapter. Fees shall not be awarded unless the court finds that the public body, public agency, or person knew or should have known that the conduct engaged in was in violation of this chapter or if the parties, by agreement, provide that no such fees shall be paid." (2023 edition, as quoted by the court.)',
      source: 'BR',
    },
  ];

  /** Merge built-ins with user-supplied entries. User entries never overwrite built-ins. */
  function all(userEntries) {
    const ids = new Set(CITATIONS.map((c) => c.id));
    const extra = (userEntries || [])
      .filter((c) => c && c.id && c.cite && !ids.has(c.id))
      .map((c) => Object.assign({ kind: 'exemption', source: 'user', userSupplied: true }, c));
    return CITATIONS.concat(extra);
  }

  function exemptions(userEntries) {
    return all(userEntries).filter((c) => c.kind === 'exemption');
  }

  function byId(id, userEntries) {
    return all(userEntries).find((c) => c.id === id) || null;
  }

  const api = { SOURCES, CITATIONS, all, exemptions, byId,
    VERIFY_NOTE: 'Confirm the current text of every cited provision at gc.nh.gov before sending. RSA 91-A:4 entries match the text published at gc.nh.gov as of Nov. 10, 2026 (current through 2026 N.H. Laws 206:5). RSA 91-A:5 and 91-A:8 entries rest on New Hampshire Supreme Court quotations of the 2023 edition and have not been re-checked against the current statute. This software drafts documents; it does not give legal advice.' };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.RSA91A = root.RSA91A || {}; root.RSA91A.citations = api; }
})(typeof self !== 'undefined' ? self : this);
