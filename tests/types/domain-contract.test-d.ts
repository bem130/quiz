import type { PackageId, QuestionId, Revision, SessionId, UserId } from '../../src/core/identity.ts';
import type { PackageRecord, SessionRecord } from '../../src/core/records.ts';
import type { SessionConfig } from '../../src/core/session.ts';
import type { Option } from '../../src/core/result.ts';

declare const user: UserId;
declare const session: SessionId;
declare const revision: Revision;
declare const packageId: PackageId;
declare const questionId: QuestionId;
declare const config: SessionConfig;
declare const record: SessionRecord;
declare const packageRecord: PackageRecord;

// @ts-expect-error 同じ文字列表現でもユーザーをセッションとして使えない。
const wrongSession: SessionId = user;
// @ts-expect-error セッションをユーザーとして使えない。
const wrongUser: UserId = session;
// @ts-expect-error 未検証文字列をユーザーIDとして使えない。
const uncheckedUser: UserId = 'guest';
// @ts-expect-error JSON文字列でもschemaを通していないrevisionは使えない。
const uncheckedRevision: Revision = '{}';
// @ts-expect-error 題庫IDを問題IDとして使えない。
const wrongQuestion: QuestionId = packageId;
// @ts-expect-error 問題IDを題庫IDとして使えない。
const wrongPackage: PackageId = questionId;
// @ts-expect-error session開始APIにも役割の取り違えを持ち込めない。
const wrongConfig: SessionConfig = { ...config, id: user };
// @ts-expect-error 保存DTOでもrevisionとユーザーIDの取り違えを拒否する。
const wrongPackageRecord: PackageRecord = { ...packageRecord, revision: user };
// @ts-expect-error 確定した保存DTOは読み取り専用である。
record.userId = user;
// @ts-expect-error 正本の出題範囲は直接変更できない。
config.allowedPatternIds[0] = 'pattern';
// @ts-expect-error DOM参照は保存DTOの一部ではない。
const viewRecord: SessionRecord = { ...record, element: document.body };
// @ts-expect-error 内部の欠損はnullではなくOptionで表す。
const missingUser: Option<UserId> = null;

void [revision, wrongSession, wrongUser, uncheckedUser, uncheckedRevision, wrongQuestion,
    wrongPackage, wrongConfig, wrongPackageRecord, viewRecord, missingUser];
