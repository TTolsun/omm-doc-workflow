// 설정을 읽지 않는 순수 텍스트 도우미. 검사기처럼 프로젝트 설정 없이 단독으로 쓰이는 모듈이 가져갑니다.

// 근거와 원고는 텍스트이므로 체크아웃 줄 끝 차이는 변경이 아닙니다.
export const normalizeText = (text) => text.replace(/\r\n/g, "\n");
