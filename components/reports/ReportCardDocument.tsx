/**
 * ReportCardDocument — the actual PDF layout, built with
 * @react-pdf/renderer (`npm i @react-pdf/renderer`). This renders on the
 * server via `renderToBuffer` (see app/api/report-cards/[studentId]/[termId]/route.ts)
 * or in the browser via `pdf(<ReportCardDocument .../>).toBlob()` for a
 * quick-preview download button.
 *
 * Kept visually consistent with the rest of the platform — same crimson
 * (#AB1509) / cream (#fff7d3) / ink (#1A1A1A) tokens as tailwind.config.ts
 * — but react-pdf has its own StyleSheet API (no Tailwind classes here).
 */

import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { ReportCardData } from "./types";

// Font: the server route registers Liberation Sans (lib/reportFonts.ts) and passes its family name
// in as `fontFamily`, so Yoruba/Igbo/Hausa letters (ẹ ọ ṣ ị ụ ɓ ɗ ƙ and tone marks) print. If no family
// is passed (e.g. a browser-side preview) it uses react-pdf's built-in Helvetica, which only covers
// Latin-1. fontWeight 600/700 below both resolve to the bold face.
const CRIMSON = "#AB1509";
const CREAM = "#fff7d3";
const INK = "#1A1A1A";
const MUTED = "#6B6B6B";
const BORDER = "#E5E1D8";

const styles = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 9.5, color: INK },

  header: { flexDirection: "row", alignItems: "center", borderBottomWidth: 2, borderBottomColor: CRIMSON, paddingBottom: 12, marginBottom: 14 },
  logo: { width: 44, height: 44, marginRight: 12, objectFit: "contain" },
  schoolName: { fontSize: 15, fontWeight: 700, color: CRIMSON },
  schoolMotto: { fontSize: 8.5, color: MUTED, marginTop: 1 },
  schoolAddress: { fontSize: 8, color: MUTED, marginTop: 1 },

  titleBar: { alignItems: "center", marginBottom: 14 },
  titleText: { fontSize: 11, fontWeight: 700, letterSpacing: 1 },
  subtitleText: { fontSize: 9, color: MUTED, marginTop: 2 },

  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  infoCol: { flexDirection: "column", justifyContent: "center" },
  infoLine: { flexDirection: "row", marginBottom: 3 },
  infoLabel: { width: 90, color: MUTED },
  infoValue: { fontWeight: 600 },
  photoBox: { width: 64, height: 72, borderWidth: 1, borderColor: BORDER, borderRadius: 4, objectFit: "cover" },
  photoPlaceholder: { width: 64, height: 72, borderWidth: 1, borderColor: BORDER, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  photoPlaceholderText: { fontSize: 7, color: MUTED },

  table: { borderWidth: 1, borderColor: BORDER, borderRadius: 4, marginBottom: 14 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: CREAM, paddingVertical: 6, paddingHorizontal: 8 },
  tableRow: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: BORDER },
  colSubject: { flex: 2.4, fontWeight: 600 },
  colScore: { flex: 1, textAlign: "center" },
  colGrade: { flex: 0.8, textAlign: "center", fontWeight: 700 },
  colRemark: { flex: 1.6, textAlign: "left", color: MUTED },
  headerCell: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", color: MUTED },

  summaryRow: { flexDirection: "row", justifyContent: "space-between", backgroundColor: CREAM, borderRadius: 4, padding: 10, marginBottom: 16 },
  summaryItem: { alignItems: "center" },
  summaryValue: { fontSize: 13, fontWeight: 700, color: CRIMSON },
  summaryLabel: { fontSize: 7.5, color: MUTED, marginTop: 1 },

  commentBox: { borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 10, marginBottom: 20, minHeight: 46 },
  commentLabel: { fontSize: 8, fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: 4 },

  signatureRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  signatureCol: { width: "45%", alignItems: "center" },
  signatureLine: { borderTopWidth: 1, borderTopColor: INK, width: "100%", marginTop: 24, paddingTop: 4 },
  signatureCaption: { fontSize: 8, color: MUTED },
  stampBox: { width: 60, height: 40, borderWidth: 1, borderColor: BORDER, borderStyle: "dashed", borderRadius: 4, marginBottom: 6 },

  footer: { position: "absolute", bottom: 20, left: 36, right: 36, textAlign: "center", fontSize: 7, color: MUTED },
});

export default function ReportCardDocument({ data, fontFamily = "Helvetica" }: { data: ReportCardData; fontFamily?: string }) {
  return (
    <Document>
      <Page size="A4" style={[styles.page, { fontFamily }]}>
        {/* Letterhead */}
        <View style={styles.header}>
          {data.logoUrl && <Image src={data.logoUrl} style={styles.logo} />}
          <View>
            <Text style={styles.schoolName}>{data.schoolName}</Text>
            {data.schoolMotto && <Text style={styles.schoolMotto}>{data.schoolMotto}</Text>}
            {data.schoolAddress && <Text style={styles.schoolAddress}>{data.schoolAddress}</Text>}
          </View>
        </View>

        <View style={styles.titleBar}>
          <Text style={styles.titleText}>TERMINAL REPORT CARD</Text>
          <Text style={styles.subtitleText}>{data.termName} · {data.sessionName}</Text>
        </View>

        {/* Student info + photo */}
        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Student name</Text>
              <Text style={styles.infoValue}>{data.studentName}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Student ID</Text>
              <Text style={styles.infoValue}>{data.admissionNumber}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Class</Text>
              <Text style={styles.infoValue}>{data.className}</Text>
            </View>
            <View style={styles.infoLine}>
              <Text style={styles.infoLabel}>Position in class</Text>
              <Text style={styles.infoValue}>{data.positionInClass} of {data.classSize}</Text>
            </View>
          </View>
          {data.studentPhotoUrl ? (
            <Image src={data.studentPhotoUrl} style={styles.photoBox} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderText}>Photo</Text>
            </View>
          )}
        </View>

        {/* Subject breakdown */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colSubject, styles.headerCell]}>Subject</Text>
            <Text style={[styles.colScore, styles.headerCell]}>CA/CBT</Text>
            <Text style={[styles.colScore, styles.headerCell]}>Terminal</Text>
            <Text style={[styles.colScore, styles.headerCell]}>Total</Text>
            <Text style={[styles.colGrade, styles.headerCell]}>Grade</Text>
            <Text style={[styles.colRemark, styles.headerCell]}>Remark</Text>
          </View>
          {data.subjects.map((s, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.colSubject}>{s.subjectName}</Text>
              <Text style={styles.colScore}>{s.caScore.toFixed(1)}</Text>
              <Text style={styles.colScore}>{s.terminalScore.toFixed(1)}</Text>
              <Text style={styles.colScore}>{s.totalScore.toFixed(1)}/{s.maxScore}</Text>
              <Text style={styles.colGrade}>{s.gradeLetter ?? "—"}</Text>
              <Text style={styles.colRemark}>{s.remark ?? ""}</Text>
            </View>
          ))}
        </View>

        {/* Summary */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{data.overallTotal.toFixed(1)}/{data.overallMaxTotal}</Text>
            <Text style={styles.summaryLabel}>OVERALL SCORE</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{data.overallGradeLetter ?? "—"}</Text>
            <Text style={styles.summaryLabel}>OVERALL GRADE</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{data.positionInClass}/{data.classSize}</Text>
            <Text style={styles.summaryLabel}>CLASS POSITION</Text>
          </View>
        </View>

        {/* Teacher comment */}
        <View style={styles.commentBox}>
          <Text style={styles.commentLabel}>Class teacher's comment</Text>
          <Text>{data.teacherComment ?? ""}</Text>
        </View>

        {/* Signatures */}
        <View style={styles.signatureRow}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine}>
              <Text style={styles.signatureCaption}>Class Teacher</Text>
            </View>
          </View>
          <View style={styles.signatureCol}>
            <View style={styles.stampBox} />
            <View style={styles.signatureLine}>
              <Text style={styles.signatureCaption}>{data.principalName ? `${data.principalName} — Principal` : "Principal"}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.footer}>Generated by the {data.schoolName} CBT Platform · {new Date().toLocaleDateString()}</Text>
      </Page>
    </Document>
  );
}
