import { schoolApi, SchoolApiError, rememberSchoolSession, forgetMatchingSchoolSession } from './schoolApi'
import type { SchoolSession, SchoolClass, RemoteRegister } from './schoolApi'
import { readSchoolData, updateSchoolClasses, mergeSchoolRemote, acknowledgeSchoolUpload, flagSchoolIssue } from './schoolStorage'

function checkOwner(session: SchoolSession, response: { userId: string; schoolId: string }) {
  if (response.userId !== session.user.id || response.schoolId !== session.user.schoolId) {
    forgetMatchingSchoolSession(session)
    throw new SchoolApiError('A different account is signed in. Reopen the school workspace.', 401)
  }
}

export async function syncSchool(session: SchoolSession) {
  const live = await schoolApi<SchoolSession>('/auth/me').catch((error) => {
    if (error instanceof SchoolApiError && error.status === 401) forgetMatchingSchoolSession(session)
    throw error
  })
  checkOwner(session, { userId: live.user.id, schoolId: live.user.schoolId })
  rememberSchoolSession(live)
  const result = await schoolApi<{ userId: string; schoolId: string; classes: SchoolClass[] }>('/classes')
  checkOwner(session, result)
  updateSchoolClasses(live, result.classes)
  let uploaded = 0

  async function pull(classId: string) {
    const result = await schoolApi<{ userId: string; schoolId: string; records: RemoteRegister[] }>(`/classes/${classId}/registers`)
    checkOwner(session, result)
    for (const remote of result.records) mergeSchoolRemote(live, remote)
  }
  for (const cls of result.classes) {
    try { await pull(cls.id) } catch (error) {
      if (error instanceof SchoolApiError && error.status === 404) {
        for (const row of readSchoolData(live).entries.filter((row) => row.classId === cls.id)) flagSchoolIssue(live, row.classId, row.date, error.message)
        continue
      }
      throw error
    }
    for (const row of readSchoolData(live).entries.filter((row) => row.classId === cls.id && row.pending && !row.issue)) {
      const pending = row.pending!
      try {
        const remote = await schoolApi<RemoteRegister>(`/classes/${cls.id}/registers/${row.date}`, 'PUT', {
          record: pending.record, baseVersion: pending.baseVersion, rosterVersion: pending.rosterVersion,
          mutationId: pending.mutationId, expectedUserId: live.user.id, expectedSchoolId: live.user.schoolId,
        })
        acknowledgeSchoolUpload(live, pending, remote)
        uploaded += 1
      } catch (error) {
        if (error instanceof SchoolApiError && [400, 404, 409].includes(error.status)) {
          if (error.detail.current) mergeSchoolRemote(live, error.detail.current as RemoteRegister)
          flagSchoolIssue(live, cls.id, row.date, error.message)
          continue
        }
        throw error
      }
    }
    // Fetch again so an idempotent replay cannot leave a newer school version hidden.
    await pull(cls.id)
  }
  const data = readSchoolData(live)
  return { session: live, uploaded, queued: data.entries.filter((row) => row.pending).length,
    conflicts: data.entries.filter((row) => row.issue).length }
}
