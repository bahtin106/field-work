import { render } from "@testing-library/react-native";
import React from "react";
import { Text } from "react-native";
import { LazyView } from "./LazyView";
describe("LazyView", () => {
  it("should render children when shouldUpdate is true", () => {
    const {
      getByText
    } = render( /*#__PURE__*/React.createElement(LazyView, {
      shouldUpdate: true
    }, /*#__PURE__*/React.createElement(Text, null, "Test Child")));
    expect(getByText("Test Child")).toBeTruthy();
  });
  it("should not render children when shouldUpdate is false", () => {
    const {
      queryByText
    } = render( /*#__PURE__*/React.createElement(LazyView, {
      shouldUpdate: false
    }, /*#__PURE__*/React.createElement(Text, null, "Test Child")));
    expect(queryByText("Test Child")).toBeNull();
  });
  it("should render empty fragment when shouldUpdate is false", () => {
    const {
      container
    } = render( /*#__PURE__*/React.createElement(LazyView, {
      shouldUpdate: false
    }, /*#__PURE__*/React.createElement(Text, null, "Test Child")));
    expect(container.children.length).toBe(0);
  });
  it("should handle multiple children when shouldUpdate is true", () => {
    const {
      getByText
    } = render( /*#__PURE__*/React.createElement(LazyView, {
      shouldUpdate: true
    }, /*#__PURE__*/React.createElement(Text, null, "First Child"), /*#__PURE__*/React.createElement(Text, null, "Second Child")));
    expect(getByText("First Child")).toBeTruthy();
    expect(getByText("Second Child")).toBeTruthy();
  });
  it("should not render multiple children when shouldUpdate is false", () => {
    const {
      queryByText
    } = render( /*#__PURE__*/React.createElement(LazyView, {
      shouldUpdate: false
    }, /*#__PURE__*/React.createElement(Text, null, "First Child"), /*#__PURE__*/React.createElement(Text, null, "Second Child")));
    expect(queryByText("First Child")).toBeNull();
    expect(queryByText("Second Child")).toBeNull();
  });
});
//# sourceMappingURL=LazyView.test.js.map