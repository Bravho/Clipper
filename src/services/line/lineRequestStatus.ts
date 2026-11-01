/** Read-only status text; never starts or retries production. */
export function lineRequestStatus(requestStatus: string, job?: { currentStep: string; status: string } | null): string {
  if (job?.status === 'failed' || job?.currentStep === 'failed') return 'งานเกิดข้อผิดพลาดค่ะ ทีมงานจะตรวจสอบและติดต่อกลับ';
  if (['delivered', 'published'].includes(requestStatus) || job?.currentStep === 'complete' || job?.status === 'complete') return 'งานเสร็จแล้วค่ะ พร้อมส่งมอบและดาวน์โหลด';
  if (requestStatus === 'rejected') return 'งานไม่ผ่านการรับผลิตค่ะ กรุณาติดต่อทีมงาน';
  if (requestStatus === 'auto_cancelled') return 'งานถูกยกเลิกแล้วค่ะ กรุณาติดต่อทีมงาน';
  if (requestStatus === 'on_hold') return 'งานถูกพักไว้ค่ะ ทีมงานจะติดต่อกลับ';
  if (job?.currentStep.startsWith('awaiting_')) return 'งานกำลังรอการตรวจสอบและอนุมัติค่ะ';
  if (['analyzing_content', 'generating_scene_design'].includes(job?.currentStep ?? '')) return 'กำลังวิเคราะห์ข้อมูลและจัดทำร่างโครงวิดีโอค่ะ';
  if (['generating_voice', 'processing_voice'].includes(job?.currentStep ?? '')) return 'กำลังจัดทำเสียงพากย์ค่ะ';
  if (job?.currentStep === 'publishing' || requestStatus === 'scheduled_for_publishing') return 'กำลังเตรียมเผยแพร่วิดีโอค่ะ';
  if (job || ['editing', 'revision_requested'].includes(requestStatus)) return 'กำลังตัดต่อและเรนเดอร์วิดีโอค่ะ';
  if (requestStatus === 'under_review') return 'ทีมงานกำลังตรวจสอบรายละเอียดงานค่ะ';
  if (requestStatus === 'accepted_for_production') return 'รับงานแล้วค่ะ กำลังรอเริ่มผลิต';
  return 'ได้รับงานแล้วค่ะ กำลังรอดำเนินการ';
}
